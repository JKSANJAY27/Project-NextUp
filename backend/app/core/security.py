import base64
from datetime import datetime, timedelta
from typing import Any, Union, Optional
from jose import jwt
from passlib.context import CryptContext
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import Header, HTTPException, status
from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

def create_access_token(subject: Union[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode = {"exp": expire, "sub": str(subject)}
    encoded_jwt = jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    return encoded_jwt

def decrypt_field(ciphertext_b64: str, key_hex: str) -> str:
    """
    Decrypts a client-side encrypted field (Base64 string of IV + ciphertext + tag)
    using the provided client key (hex encoded).
    """
    if not ciphertext_b64:
        return ""
    try:
        # Decode the key from hex
        key_bytes = bytes.fromhex(key_hex)
        if len(key_bytes) != 32:
            raise ValueError("Key must be 32 bytes (64 hex characters)")

        # Decode the payload
        payload = base64.b64decode(ciphertext_b64)
        if len(payload) < 28: # 12 bytes IV + at least some ciphertext + 16 bytes tag
            raise ValueError("Payload too short")

        iv = payload[:12]
        ciphertext_and_tag = payload[12:]

        # Decrypt using cryptography's AESGCM
        aesgcm = AESGCM(key_bytes)
        decrypted_bytes = aesgcm.decrypt(iv, ciphertext_and_tag, None)
        return decrypted_bytes.decode("utf-8")
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Decryption failed: {str(e)}"
        )

def encrypt_field(plaintext: str, key_hex: str) -> str:
    """
    Encrypts a field on behalf of client, for testing/verification purposes.
    Generates a 12-byte random IV, encrypts, and returns Base64 of IV + ciphertext + tag.
    """
    try:
        key_bytes = bytes.fromhex(key_hex)
        aesgcm = AESGCM(key_bytes)
        
        # Generate 12-byte random IV
        import os
        iv = os.urandom(12)
        
        ciphertext_and_tag = aesgcm.encrypt(iv, plaintext.encode("utf-8"), None)
        return base64.b64encode(iv + ciphertext_and_tag).decode("utf-8")
    except Exception as e:
         raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Encryption failed: {str(e)}"
        )

import hmac
import hashlib


def _server_key_hex(purpose: str) -> str:
    """Derive a stable 32-byte server-side AES key from the PEPPER for a given purpose."""
    digest = hashlib.sha256(f"{settings.PEPPER}:{purpose}".encode("utf-8")).hexdigest()
    return digest  # 64 hex chars == 32 bytes


def server_encrypt_field(plaintext: str, purpose: str = "ai-jobs") -> str:
    """
    Encrypt data at rest with a server-derived key (AES-GCM). Unlike the per-session
    client key, this key survives restarts, so background workers can always decrypt.
    """
    return encrypt_field(plaintext, _server_key_hex(purpose))


def server_decrypt_field(ciphertext_b64: str, purpose: str = "ai-jobs") -> str:
    return decrypt_field(ciphertext_b64, _server_key_hex(purpose))


def generate_blind_index(neo_id: str, pepper: str = None) -> str:
    """
    Generates a secure HMAC-SHA256 blind index from a normalized Neo ID.
    Normalizes the input by converting to uppercase and stripping whitespaces.
    """
    if pepper is None:
        pepper = settings.PEPPER
    normalized = neo_id.strip().upper()
    h = hmac.new(pepper.encode("utf-8"), normalized.encode("utf-8"), hashlib.sha256)
    return h.hexdigest()
