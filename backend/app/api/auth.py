import secrets
from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordBearer
from jose import jwt, JWTError
from sqlalchemy.orm import Session
from app.core.config import settings
from app.core.database import get_db
from app.core.security import get_password_hash, verify_password, create_access_token
from app.models.models import User
from app.schemas.schemas import UserRegister, UserLogin, Token, SaltResponse

router = APIRouter(prefix="/auth", tags=["auth"])

oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_V1_STR}/auth/login-oauth2-fallback")

def get_current_user(request: Request, token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise credentials_exception
    
    # Store X-Client-Key in-memory active cache if present in headers
    client_key = request.headers.get("X-Client-Key")
    if client_key:
        from app.core.gmail_token_cache import add_session_key
        add_session_key(user.id, client_key)
        
    return user

@router.post("/register", response_model=Token)
def register(user_in: UserRegister, db: Session = Depends(get_db)):
    # Validate VIT student email domain
    if not user_in.email.lower().endswith("@vitstudent.ac.in"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only VIT student emails (@vitstudent.ac.in) are allowed to register."
        )

    # Check if user already exists
    user = db.query(User).filter(User.email == user_in.email).first()
    if user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A user with this email is already registered."
        )
    
    # Generate email salt for client-side PBKDF2 key derivation
    email_salt = secrets.token_hex(16)
    
    # Hash password for database authentication
    password_hash = get_password_hash(user_in.password)
    
    new_user = User(
        email=user_in.email,
        password_hash=password_hash,
        email_salt=email_salt,
        gmail_connected=False
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    access_token = create_access_token(subject=new_user.id)
    return Token(
        access_token=access_token,
        token_type="bearer",
        email_salt=email_salt
    )

@router.post("/login", response_model=Token)
def login(request: Request, user_in: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == user_in.email).first()
    if not user or not verify_password(user_in.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incorrect email or password."
        )
    
    # Cache key if present in request headers during login
    client_key = request.headers.get("X-Client-Key")
    if client_key:
        from app.core.gmail_token_cache import add_session_key
        add_session_key(user.id, client_key)

    access_token = create_access_token(subject=user.id)
    return Token(
        access_token=access_token,
        token_type="bearer",
        email_salt=user.email_salt
    )

@router.post("/logout")
def logout(current_user: User = Depends(get_current_user)):
    from app.core.gmail_token_cache import remove_session_key
    remove_session_key(current_user.id)
    return {"message": "Successfully logged out"}

@router.get("/salt", response_model=SaltResponse)
def get_salt(email: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found."
        )
    return SaltResponse(email_salt=user.email_salt)
