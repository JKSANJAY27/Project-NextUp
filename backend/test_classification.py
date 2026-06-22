import unittest
import sys
import os

# Add backend directory to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.email_parser import build_regex_fallback_response

class TestEmailClassification(unittest.TestCase):
    
    def test_new_drive_classification(self):
        subject = "Google Recruitment Drive - Software Engineer - 2026 Batch"
        body = "Google is hiring Software Engineers. CTC: 35 LPA. Last date to register is 25-06-2026."
        
        response = build_regex_fallback_response(body, subject)
        ext_data = response.get("extracted_data", {})
        
        self.assertEqual(ext_data.get("email_category"), "NEW_DRIVE")
        self.assertEqual(ext_data.get("company", {}).get("value"), "Google")
        self.assertEqual(ext_data.get("event_type", {}).get("value"), "NEW_DRIVE")

    def test_drive_update_oa_classification(self):
        subject = "Google OA Schedule | Recruitment Drive 2026"
        body = "The Online Assessment for Google Software Engineer is scheduled on 28-06-2026."
        
        response = build_regex_fallback_response(body, subject)
        ext_data = response.get("extracted_data", {})
        
        self.assertEqual(ext_data.get("email_category"), "DRIVE_UPDATE")
        self.assertEqual(ext_data.get("company", {}).get("value"), "Google")
        self.assertEqual(ext_data.get("event_type", {}).get("value"), "OA_SCHEDULED")

    def test_drive_update_shortlist_classification(self):
        subject = "Google Shortlist Released - SDE Role"
        body = "Please find attached the list of shortlisted students for the interview rounds."
        
        response = build_regex_fallback_response(body, subject)
        ext_data = response.get("extracted_data", {})
        
        self.assertEqual(ext_data.get("email_category"), "DRIVE_UPDATE")
        self.assertEqual(ext_data.get("company", {}).get("value"), "Google")
        self.assertEqual(ext_data.get("event_type", {}).get("value"), "SHORTLIST_RELEASED")

    def test_general_announcement_litcoder(self):
        subject = "Kind Attention!! Litcoder modules completion status"
        body = """Kind Attention!!
Please find attached the list of students who have not yet completed the Litcoder modules. 

As mentioned earlier, it is mandatory to complete the Litcoder(minimum 11 modules) for placement registration.

All interested students kindly register using the link provided below on or before 17-06-2026, 11:00 AM."""
        
        response = build_regex_fallback_response(body, subject)
        ext_data = response.get("extracted_data", {})
        ann = ext_data.get("announcement", {})
        
        self.assertEqual(ext_data.get("email_category"), "GENERAL_ANNOUNCEMENT")
        self.assertEqual(ann.get("announcement_type", {}).get("value"), "TRAINING")
        self.assertIsNotNone(ann.get("title", {}).get("value"))

    def test_general_announcement_workshop(self):
        subject = "Resume Review Session and Workshop"
        body = "All interested students kindly attend the resume review session at 11:00 AM tomorrow."
        
        response = build_regex_fallback_response(body, subject)
        ext_data = response.get("extracted_data", {})
        ann = ext_data.get("announcement", {})
        
        self.assertEqual(ext_data.get("email_category"), "GENERAL_ANNOUNCEMENT")
        self.assertEqual(ann.get("announcement_type", {}).get("value"), "WORKSHOP")

if __name__ == "__main__":
    unittest.main()
