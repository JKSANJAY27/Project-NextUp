import sys
sys.stdout.reconfigure(encoding='utf-8')

from app.core.database import SessionLocal
from app.models.models import User, Resume
from app.core.gmail_token_cache import get_session_key
from app.core.security import decrypt_field
import json

db = SessionLocal()
try:
    user = db.query(User).filter(User.email == "sanjay.jk2023@vitstudent.ac.in").first()
    if not user:
        print("User not found")
        sys.exit(0)
    print(f"User ID: {user.id}")
    
    resume = db.query(Resume).filter(Resume.user_id == user.id).first()
    if not resume:
        print("No resume database record found")
    else:
        print(f"Resume ID: {resume.id}")
        print(f"Resume JSON Encrypted exists: {resume.resume_json_enc is not None}")
        print(f"Raw Text Encrypted exists: {resume.raw_text_enc is not None}")
        
        derived_key = get_session_key(user.id)
        print(f"Vault derived_key in cache: {derived_key is not None}")
        
        # If derived_key is not in cache, let's list keys in cache to see if any exist
        from app.core.gmail_token_cache import _session_keys
        print(f"All cached keys: {list(_session_keys.keys())}")
        
        # Let's decrypt using the first available key if any, or print the encrypted data length
        if resume.resume_json_enc:
            print(f"Encrypted string length: {len(resume.resume_json_enc)}")
            # Try to decrypt with active keys if possible
            for uid, key in _session_keys.items():
                try:
                    dec = decrypt_field(resume.resume_json_enc, key)
                    print(f"Successfully decrypted using key for user {uid}:")
                    print(json.dumps(json.loads(dec), indent=2))
                except Exception as e:
                    print(f"Decrypt attempt failed with key for user {uid}: {e}")

finally:
    db.close()
