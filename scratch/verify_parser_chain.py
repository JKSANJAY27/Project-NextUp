import os
import sys
import sqlite3
import json
from datetime import datetime
from unittest.mock import patch, MagicMock

# Add backend directory to sys.path
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend"))
sys.path.insert(0, backend_dir)

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.dialects.postgresql import ARRAY

from app.core.database import Base
from app.models.models import (
    User, Company, CompanyEvent, Application, StudentProfile,
    RawIngestionJob, IngestionAuditLog, AttachmentMetadata
)
from app.services.email_parser import (
    parse_placement_email, is_high_confidence, build_regex_fallback_response
)
from app.services.validator import validate_and_normalize_parsed_data, normalize_company_name
from app.services.gmail_sync import process_queued_jobs

# Support lists in SQLite
sqlite3.register_adapter(list, lambda l: json.dumps(l))

@compiles(ARRAY, "sqlite")
def compile_array_sqlite(element, compiler, **kw):
    return "TEXT"

TEST_DB_URL = "sqlite:///./test_parser_chain.db"
if os.path.exists("./test_parser_chain.db"):
    os.remove("./test_parser_chain.db")

engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Create tables
Base.metadata.create_all(bind=engine)

def run_tests():
    db = TestingSessionLocal()
    try:
        print("--- Start E2E Parser Chain & Multi-Role Pipeline Verification ---")

        # -------------------------------------------------------------
        # 1. Test Confidence Evaluator (is_high_confidence)
        # -------------------------------------------------------------
        high_conf_payload = {
            "parser_metadata": {
                "parser_version": "v2",
                "model_used": "mock"
            },
            "overall_confidence": 0.85,
            "extracted_data": {
                "company": {"value": "Google", "confidence": 0.90},
                "event_type": {"value": "NEW_DRIVE", "confidence": 0.95},
                "deadline_iso": {"value": "2026-06-25T23:59:00", "confidence": 0.85}
            }
        }
        low_conf_payload = {
            "parser_metadata": {
                "parser_version": "v2",
                "model_used": "mock"
            },
            "overall_confidence": 0.65, # Overall too low
            "extracted_data": {
                "company": {"value": "Google", "confidence": 0.90},
                "event_type": {"value": "NEW_DRIVE", "confidence": 0.95}
            }
        }
        low_field_payload = {
            "parser_metadata": {
                "parser_version": "v2",
                "model_used": "mock"
            },
            "overall_confidence": 0.85,
            "extracted_data": {
                "company": {"value": "Google", "confidence": 0.70}, # Core field too low
                "event_type": {"value": "NEW_DRIVE", "confidence": 0.95}
            }
        }

        assert is_high_confidence(high_conf_payload) is True, "High confidence payload failed check"
        assert is_high_confidence(low_conf_payload) is False, "Low overall confidence payload should fail check"
        assert is_high_confidence(low_field_payload) is False, "Low core field confidence payload should fail check"
        print("OK: is_high_confidence checks verified.")

        # -------------------------------------------------------------
        # 2. Test Parser Escalation Chain (Ollama -> HF -> Regex)
        # -------------------------------------------------------------
        with patch("app.services.email_parser.requests.post") as mock_post:
            # Case 2A: Ollama returns high confidence
            mock_ollama_res = MagicMock()
            mock_ollama_res.status_code = 200
            mock_ollama_res.json.return_value = {
                "response": json.dumps(high_conf_payload)
            }
            mock_post.return_value = mock_ollama_res

            res = parse_placement_email("Mock body text")
            assert "parser_metadata" in res, f"Expected parser_metadata to be in response: {res}"
            assert res["parser_metadata"]["model_used"] == "ollama-qwen2.5:1.5b", f"Expected Ollama metadata, got: {res}"
            assert mock_post.call_count == 1, "Should only query Ollama"
            
            mock_post.reset_mock()

            # Case 2B: Ollama returns low confidence -> Escalates to Hugging Face
            mock_post.side_effect = [
                # First call (Ollama)
                MagicMock(status_code=200, json=lambda: {"response": json.dumps(low_conf_payload)}),
                # Second call (Hugging Face)
                MagicMock(status_code=200, json=lambda: [{"generated_text": json.dumps(high_conf_payload)}])
            ]

            # Need HF token in env to test escalation path trigger
            os.environ["HF_API_TOKEN"] = "mock-token"
            res = parse_placement_email("Mock body text")
            assert "huggingface" in res["parser_metadata"]["model_used"], f"Should have escalated to HF, got: {res}"
            assert mock_post.call_count == 2, f"Should call both Ollama and HF. Count: {mock_post.call_count}"

            mock_post.reset_mock()
            mock_post.side_effect = None

            # Case 2C: Ollama and Hugging Face both fail -> Regex Fallback
            mock_post.side_effect = Exception("Connection Refused")
            res = parse_placement_email("Subject: Nokia Drive\nBody: Company: Nokia\nRole: SWE\nCTC: 12 LPA\nLast Date: 20 June 2026")
            assert "regex" in res["parser_metadata"]["parser_version"], f"Should fall back to regex, got: {res}"
            print("OK: Parser escalation chain verified.")

        # -------------------------------------------------------------
        # 3. Test Validator & Normalizer
        # -------------------------------------------------------------
        # Seed an existing company to test fuzzy normalization matching
        ex_company = Company(name="Google India Pvt Ltd", role="SWE", category="Dream", fingerprint="fp_existing")
        db.add(ex_company)
        db.commit()

        raw_llm_output = {
            "parser_metadata": {
                "parser_version": "v2",
                "model_used": "mock"
            },
            "overall_confidence": 0.85,
            "extracted_data": {
                "company": {"value": "Google Inc", "confidence": 0.90},
                "event_type": {"value": "OA_SCHEDULED", "confidence": 0.95},
                "deadline_iso": {"value": "2026-06-25T23:59:00", "confidence": 0.85},
                "job_location": {"value": "Bangalore", "confidence": 0.85},
                "registration_link": {"value": "https://forms.gle/xyz", "confidence": 0.95},
                "roles": [
                    {
                        "role": {"value": "swe", "confidence": 0.90},
                        "ctc": {"value": "20 LPA", "confidence": 0.90},
                        "stipend": {"value": "50k", "confidence": 0.90},
                        "eligible_branches": {"value": ["CSE", "IT"], "confidence": 0.90},
                        "min_cgpa": {"value": 8.0, "confidence": 0.90},
                        "requires_no_arrears": {"value": True, "confidence": 0.90}
                    }
                ]
            }
        }

        validated = validate_and_normalize_parsed_data(raw_llm_output, db)
        ext = validated["extracted_data"]
        
        # Check normalizations
        assert ext["company"]["value"] == "Google India Pvt Ltd", f"Expected Google India Pvt Ltd (fuzzy matched), got: {ext['company']['value']}"
        assert ext["event_type"]["value"] == "OA", f"Expected event type OA, got: {ext['event_type']['value']}"
        assert ext["roles"][0]["role"]["value"] == "Software Engineer", f"Expected normalized role Software Engineer, got: {ext['roles'][0]['role']['value']}"
        assert validated["parser_metadata"]["requires_review"] is False, "Confidence is high, should not require review"

        # Check that low confidence flags requires_review
        low_conf_llm_output = dict(raw_llm_output)
        low_conf_llm_output["extracted_data"]["company"]["confidence"] = 0.50 # Low confidence on company name
        validated_low = validate_and_normalize_parsed_data(low_conf_llm_output, db)
        assert validated_low["parser_metadata"]["requires_review"] is True, "Low confidence company should require review"
        print("OK: Validator & Normalizer rules verified.")

        # -------------------------------------------------------------
        # 4. Sync Worker Multi-Role Splitting E2E
        # -------------------------------------------------------------
        # Mock the parser to return a multi-role structure
        multi_role_llm_output = {
            "parser_metadata": {
                "parser_version": "v2",
                "model_used": "mock"
            },
            "overall_confidence": 0.88,
            "extracted_data": {
                "company": {"value": "Amazon India", "confidence": 0.95},
                "event_type": {"value": "NEW_DRIVE", "confidence": 0.95},
                "deadline_iso": {"value": "2026-06-25T23:59:00", "confidence": 0.90},
                "job_location": {"value": "Hyderabad", "confidence": 0.85},
                "registration_link": {"value": "https://amazon.jobs", "confidence": 0.95},
                "roles": [
                    {
                        "role": {"value": "sde", "confidence": 0.95},
                        "ctc": {"value": "30 LPA", "confidence": 0.95},
                        "stipend": {"value": "80,000 pm", "confidence": 0.95},
                        "eligible_branches": {"value": ["CSE", "IT"], "confidence": 0.90},
                        "min_cgpa": {"value": 8.5, "confidence": 0.95},
                        "requires_no_arrears": {"value": True, "confidence": 0.95}
                    },
                    {
                        "role": {"value": "data scientist", "confidence": 0.90},
                        "ctc": {"value": "25 LPA", "confidence": 0.90},
                        "stipend": {"value": "70,000 pm", "confidence": 0.90},
                        "eligible_branches": {"value": ["CSE", "IT", "ECE"], "confidence": 0.80},
                        # Force deadline low confidence to test review flags and audit logs
                        "min_cgpa": {"value": 8.0, "confidence": 0.90},
                        "requires_no_arrears": {"value": False, "confidence": 0.90}
                    }
                ]
            }
        }

        # Modify mock to force a low confidence field to trigger requires_review & audit logs
        # E.g. make deadline low confidence in multi-role output
        multi_role_llm_output["extracted_data"]["deadline_iso"]["confidence"] = 0.60

        raw_job_payload = {
            "message_id": "msg_12345",
            "sender": "cdc@vit.ac.in",
            "subject": "Amazon Recruitment Drive 2026",
            "body": "Amazon is visiting for two roles: SDE and Data Scientist. Register at https://amazon.jobs before 25 June.",
            "timestamp": "2026-06-19T09:00:00Z",
            "attachments": []
        }

        raw_job = RawIngestionJob(
            status="pending",
            payload=raw_job_payload
        )
        db.add(raw_job)
        db.commit()

        print("Running sync worker queue processor...")
        # Patch the parser chain to return our predefined multi-role response
        with patch("app.services.gmail_sync.parse_placement_email", return_value=multi_role_llm_output):
            process_queued_jobs(db, job_id=str(raw_job.id))

        # Check job completion state
        db.refresh(raw_job)
        assert raw_job.status == "completed", f"Job status should be completed, got: {raw_job.status}"
        assert raw_job.parsed_output is not None, "parsed_output must be stored"
        assert raw_job.validated_output is not None, "validated_output must be stored"
        print("OK: Job payload saving verified.")

        # Check split workspaces (two different roles)
        companies_added = db.query(Company).filter(Company.name == "Amazon India").all()
        assert len(companies_added) == 2, f"Should have created exactly 2 companies for multi-role email! Got: {len(companies_added)}"
        
        roles = [c.role for c in companies_added]
        assert "Software Engineer" in roles, "SDE role not found in created companies"
        assert "Data Scientist" in roles, "Data Scientist role not found in created companies"
        
        # Verify separate fingerprints
        assert companies_added[0].fingerprint != companies_added[1].fingerprint, "Multi-role workspaces must have unique fingerprints"
        print("OK: Workspace splitting & fingerprinting verified.")

        # Verify requires_review flag propagation
        for c in companies_added:
            assert c.requires_review is True, f"Company requires_review should be True due to low confidence deadline. Got: {c.requires_review}"
        print("OK: Requires review flag propagation verified.")

        # Verify Ingestion Audit Log entry creation
        audit_logs = db.query(IngestionAuditLog).all()
        print(f"Audit logs created count: {len(audit_logs)}")
        assert len(audit_logs) >= 1, "At least 1 audit log should be written for low-confidence deadline"
        deadline_log = next((l for l in audit_logs if l.field_name == "deadline_iso"), None)
        assert deadline_log is not None, "No audit log found for deadline_iso"
        assert deadline_log.confidence_score == 60.0, f"Expected 60.0 confidence score, got: {deadline_log.confidence_score}"
        print("OK: Ingestion audit log entry verification passed.")

        print("--- All E2E Integration Tests Passed Successfully! ---")

    finally:
        db.close()
        engine.dispose()
        if os.path.exists("./test_parser_chain.db"):
            try:
                os.remove("./test_parser_chain.db")
            except Exception as e:
                print(f"Warning: could not remove test DB: {e}")

if __name__ == "__main__":
    run_tests()
