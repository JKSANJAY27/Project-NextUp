import logging
import base64
import json
import urllib.request
from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordBearer
from jose import jwt, JWTError
from sqlalchemy.orm import Session
from sqlalchemy.exc import OperationalError as SAOperationalError
from app.core.config import settings
from app.core.database import get_db
from app.models.models import User

router = APIRouter(prefix="/auth", tags=["auth"])

oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_V1_STR}/auth/login-oauth2-fallback")

# Global JWKS cache
JWKS_CACHE = None

def fetch_jwks():
    global JWKS_CACHE
    if JWKS_CACHE is not None:
        return JWKS_CACHE
    try:
        jwks_url = f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1/.well-known/jwks.json"
        with urllib.request.urlopen(jwks_url) as response:
            JWKS_CACHE = json.loads(response.read().decode())
        return JWKS_CACHE
    except Exception as e:
        logging.error(f"Failed to fetch JWKS: {e}")
        return None

# Supabase stores JWT secret as base64. Decode it to bytes for proper verification.
def _get_jwt_secret():
    try:
        secret = settings.JWT_SECRET
        padding = 4 - len(secret) % 4
        if padding != 4:
            secret += "=" * padding
        return base64.b64decode(secret)
    except Exception:
        return settings.JWT_SECRET

JWT_SECRET_DECODED = _get_jwt_secret()

def get_current_user(request: Request, token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    try:
        # 1. Inspect header to determine algorithm
        unverified_header = jwt.get_unverified_header(token)
        alg = unverified_header.get("alg")
        
        if alg == "ES256":
            # 2. Asymmetric ES256 verification using JWKS
            jwks = fetch_jwks()
            if not jwks:
                raise JWTError("JWKS not available")
            
            payload = jwt.decode(
                token, 
                jwks, 
                algorithms=["ES256"], 
                options={"verify_aud": False}
            )
        else:
            # 3. Symmetric HS256 verification using secret
            payload = jwt.decode(
                token, 
                JWT_SECRET_DECODED, 
                algorithms=["HS256"], 
                options={"verify_aud": False}
            )
            
        user_id: str = payload.get("sub")
        if user_id is None:
            raise credentials_exception
            
    except JWTError as e:
        logging.error(f"JWT decode error ({alg if 'alg' in locals() else 'unknown'}): {str(e)}")
        # If JWKS failed, try to refresh once
        if "JWKS" in str(e) or "key" in str(e).lower():
            global JWKS_CACHE
            JWKS_CACHE = None # Force refresh next time
        raise credentials_exception
    
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if user is None:
            # Auto-create user from Supabase JWT if not in our DB
            email = payload.get("email")
            if not email:
                raise credentials_exception
                
            user = User(id=user_id, email=email, role="student")
            db.add(user)
            try:
                db.commit()
                db.refresh(user)
            except Exception as e:
                db.rollback()
                logging.error(f"Failed to auto-create user: {str(e)}")
                raise credentials_exception
    except SAOperationalError as e:
        logging.error(f"DB connection error in get_current_user: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database temporarily unavailable. Please retry.",
        )
    
    # Expose the user id for per-user rate limiting (see app.core.ratelimit)
    request.state.rate_user_id = str(user.id)

    # Store X-Client-Key in-memory active cache if present in headers
    client_key = request.headers.get("X-Client-Key")
    if client_key:
        from app.core.gmail_token_cache import add_session_key
        add_session_key(user.id, client_key)
        
    return user

