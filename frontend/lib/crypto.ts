// WebCrypto GCM AES-256 Client-Side Encryption/Decryption Helpers

// Helper to convert Uint8Array to Base64 in browser
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

// Helper to convert Base64 to Uint8Array in browser
function base64ToArrayBuffer(base64: string): Uint8Array {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Helper to convert ArrayBuffer to Hex String
function arrayBufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Derives an AES-256-GCM key from a password and salt using PBKDF2.
 */
export async function deriveKey(password: string, saltHex: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passwordBytes = encoder.encode(password);
  
  // Convert hex salt to bytes
  const saltBytes = new Uint8Array(
    saltHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
  );

  // Import raw password as key material
  const baseKey = await window.crypto.subtle.importKey(
    "raw",
    passwordBytes,
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  // Derive AES-GCM 256-bit key
  return await window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: 100000,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    true, // extractable (so we can export raw bytes to send to server in header)
    ["encrypt", "decrypt"]
  );
}

/**
 * Exports a CryptoKey to a Hex String for the X-Client-Key header.
 */
export async function exportKeyToHex(key: CryptoKey): Promise<string> {
  const exported = await window.crypto.subtle.exportKey("raw", key);
  return arrayBufferToHex(exported);
}

/**
 * Encrypts plaintext using AES-256-GCM.
 * Returns a Base64 string containing concatenated: IV (12 bytes) + Ciphertext (with Tag).
 */
export async function encryptData(plaintext: string, key: CryptoKey): Promise<string> {
  if (!plaintext) return "";
  
  const encoder = new TextEncoder();
  const dataBytes = encoder.encode(plaintext);
  
  // Generate 12-byte cryptographically secure random IV
  const iv = window.crypto.getRandomValues(new Uint8Array(12));

  // Encrypt (WebCrypto automatically appends the 16-byte authentication tag to the ciphertext)
  const ciphertextBuffer = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    key,
    dataBytes
  );

  // Concatenate IV + Ciphertext (with tag)
  const ciphertextBytes = new Uint8Array(ciphertextBuffer);
  const combined = new Uint8Array(iv.length + ciphertextBytes.length);
  combined.set(iv, 0);
  combined.set(ciphertextBytes, iv.length);

  return arrayBufferToBase64(combined.buffer);
}

/**
 * Decrypts a Base64 ciphertext (IV + Ciphertext + Tag) using AES-256-GCM.
 */
export async function decryptData(ciphertextB64: string, key: CryptoKey): Promise<string> {
  if (!ciphertextB64) return "";

  const combined = base64ToArrayBuffer(ciphertextB64);
  if (combined.length < 28) {
    throw new Error("Ciphertext payload too short.");
  }

  // Extract IV (first 12 bytes)
  const iv = combined.slice(0, 12);
  
  // Extract Ciphertext & Tag (rest of bytes)
  const ciphertextBytes = combined.slice(12);

  // Decrypt
  const decryptedBuffer = await window.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    key,
    ciphertextBytes
  );

  const decoder = new TextDecoder();
  return decoder.decode(decryptedBuffer);
}
