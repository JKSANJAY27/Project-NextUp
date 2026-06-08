import os
from pydantic_settings import BaseSettings
from typing import List

class Settings(BaseSettings):
    PROJECT_NAME: str = "NextupAI"
    API_V1_STR: str = "/api"
    
    # Security
    JWT_SECRET: str = "supersecret_nextupai_key_change_me_in_prod"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days
    
    # Database (local dev defaults to SQLite)
    DATABASE_URL: str = "sqlite:///./nextup.db"
    
    # Extensible University Defaults (VIT Vellore)
    UNIVERSITY_NAME: str = "Vellore Institute of Technology"
    # User's pattern: length 8, alternating letter and digit (e.g. F4O0V3W3)
    NEO_ID_REGEX: str = r"^[A-Za-z]\d[A-Za-z]\d[A-Za-z]\d[A-Za-z]\d$"
    CDC_SENDER_EMAIL: str = "cdc@vit.ac.in"
    PLACEMENT_CATEGORIES: List[str] = ["Dream", "Super Dream", "Mass Recruiter", "Internship", "Regular"]

    class Config:
        case_sensitive = True
        env_file = ".env"

settings = Settings()
