import os
from pydantic_settings import BaseSettings
from typing import List

class Settings(BaseSettings):
    PROJECT_NAME: str = "NextupAI"
    API_V1_STR: str = "/api"
    
    # Security
    JWT_SECRET: str = "supersecret_nextupai_key_change_me_in_prod"
    JWT_ALGORITHM: str = "HS256"
    PEPPER: str = "supersecret_nextupai_pepper_key_change_me_in_prod"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days
    
    # Database (local dev defaults to SQLite)
    DATABASE_URL: str = "sqlite:///./nextup.db"
    # Empty by default: production must explicitly provide the managed Redis
    # endpoint (for Upstash, use its rediss:// URL). Falling back to localhost
    # in a cloud container silently disabled caching and added failed connects.
    REDIS_URL: str = ""
    REDIS_MAX_CONNECTIONS: int = 50
    REDIS_SOCKET_TIMEOUT_SECONDS: float = 0.75
    
    # Google Credentials
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    MOCK_GMAIL: bool = False

    # Frontend origin used for post-OAuth redirects (set to the deployed URL in prod)
    FRONTEND_URL: str = "http://localhost:3000"
    # Google OAuth (login/register) accounts must belong to this domain
    ALLOWED_GOOGLE_DOMAIN: str = "vitstudent.ac.in"
    
    # Extensible University Defaults (VIT Vellore)
    UNIVERSITY_NAME: str = "Vellore Institute of Technology"
    # User's pattern: length 8, alternating letter and digit (e.g. K9B8C7D6)
    NEO_ID_REGEX: str = r"^[A-Za-z]\d[A-Za-z]\d[A-Za-z]\d[A-Za-z]\d$"
    CDC_SENDER_EMAIL: str = "cdc@vit.ac.in"
    # Issue-report mailer. Configure these in the backend environment; never expose them to the frontend.
    FEEDBACK_RECIPIENT_EMAIL: str = "j.k.sanjay2006@gmail.com, haritottatry@gmail.com"
    FEEDBACK_FROM_EMAIL: str = ""
    FEEDBACK_SMTP_HOST: str = ""
    FEEDBACK_SMTP_PORT: int = 587
    FEEDBACK_SMTP_USERNAME: str = ""
    FEEDBACK_SMTP_PASSWORD: str = ""
    RESEND_API_KEY: str = ""
    PLACEMENT_CATEGORIES: List[str] = ["Dream", "Super Dream", "Mass Recruiter", "Internship", "Regular"]

    # AI Integration
    HF_API_TOKEN: str = ""
    INGEST_AUTH_TOKEN: str = ""
    SUPABASE_URL: str = "https://fgsmxbabgumryumcirfj.supabase.co"

    # --- Centralized AI service (AIProvider gateway) ---
    # Email parser inference (Ollama in this container, or a remote parser Space)
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "qwen2.5:1.5b"
    # Dedicated resume-generation Hugging Face Space (independent deployment).
    # Empty = resume gateway falls back to HF router / local Ollama.
    RESUME_AI_BASE_URL: str = os.getenv("HUGGINGFACE_RESUME_SPACE_URL", "")
    RESUME_AI_MODEL: str = "qwen2.5:3b"   # Ollama model inside the resume Space
    RESUME_AI_AUTH_TOKEN: str = ""
    # Dedicated parser HF Space (can share the resume Space URL for now).
    # When set, the parser gateway uses this Space first (free, unlimited)
    # before falling back to the metered HF Router.
    PARSER_AI_BASE_URL: str = os.getenv("HUGGINGFACE_PARSER_SPACE_URL",
                              os.getenv("HUGGINGFACE_RESUME_SPACE_URL", ""))
    PARSER_AI_MODEL: str = "qwen2.5:3b"
    PARSER_AI_AUTH_TOKEN: str = ""
    # Cold/free HF Spaces need materially longer than the generic API timeout
    # for a structured email parse; 45 seconds caused every valid parse to be
    # abandoned while the Space was still generating.
    PARSER_AI_TIMEOUT_SECONDS: int = 210
    # Free HF Spaces run on 2 vCPU: a slim prompt + ~900 output tokens still
    # takes several minutes. This is fine — resume jobs are async.
    RESUME_AI_TIMEOUT_SECONDS: int = 40
    # HF router fallback model for resume generation / JD analysis.
    # NOTE: the router is a METERED service (burns HF credits / returns 402
    # when depleted) — it is a fallback tier only, never the primary.
    HF_FALLBACK_MODEL: str = "meta-llama/Llama-3.3-70B-Instruct"
    # Gateway behaviour
    AI_REQUEST_TIMEOUT_SECONDS: int = 45
    AI_MAX_RETRIES: int = 1               # retries per provider (exponential backoff)
    AI_RETRY_BASE_DELAY_SECONDS: float = 2.0
    AI_CIRCUIT_FAILURE_THRESHOLD: int = 4  # consecutive failures before circuit opens
    AI_CIRCUIT_COOLDOWN_SECONDS: int = 120
    AI_MAX_CONCURRENT_REQUESTS: int = 4    # per-process cap across all AI calls

    # --- Email parser queue behaviour ---
    PARSER_JOBS_PER_TICK: int = 3          # drain up to N emails per 5-min cron tick
    PARSER_FAILED_RETRY_MINUTES: int = 10  # backoff before a failed parse is re-queued
    PARSER_MAX_AI_RETRIES: int = 2         # AI attempts before regex fallback kicks in
    # Rule parsing is an opt-in emergency recovery only. It lacks the context
    # needed to safely classify drive updates and shortlist stages.
    PARSER_ALLOW_REGEX_FALLBACK: bool = False

    # --- Resume generation worker ---
    RESUME_WORKER_ENABLED: bool = True
    RESUME_WORKER_CONCURRENCY: int = 2
    RESUME_WORKER_POLL_SECONDS: float = 4.0
    RESUME_JOB_MAX_RETRIES: int = 2
    RESUME_JOB_STALE_MINUTES: int = 20
    RESUME_JOBS_DAILY_LIMIT_PER_USER: int = 10
    RESUME_JOBS_MAX_BACKLOG: int = 300     # reject new jobs beyond this queue depth

    # --- Historical Bootstrap worker ---
    # Number of pending user BootstrapJobs to process per 1-minute scheduler tick.
    # At 5 users/tick with BOOTSTRAP_CHUNK_SIZE=25 companies each, 400 students
    # onboarding during orientation week complete in ~80 minutes.
    BOOTSTRAP_MAX_USERS_PER_TICK: int = 5
    # Number of companies processed per user per tick. Keeps individual ticks short
    # and makes the worker resumable across restarts.
    BOOTSTRAP_CHUNK_SIZE: int = 25
    # Current parser/schema versions — used ONLY by backfill_snapshots.py to detect
    # stale snapshots that need rebuilding. Runtime bootstrap code ignores these.
    BOOTSTRAP_CURRENT_PARSER_VERSION: str = "v1.0"
    BOOTSTRAP_CURRENT_SCHEMA_VERSION: int = 1

    class Config:
        case_sensitive = True
        env_file = ".env"
        extra = "ignore"


settings = Settings()
