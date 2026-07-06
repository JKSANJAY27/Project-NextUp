"""
Sanitization for user-supplied text that ends up inside LLM prompts
(prompt-injection hardening) or stored fields.

Defense in depth for AI inputs:
  1. sanitize_user_prompt() — neutralize instruction-hijack phrasing and
     chat-template control tokens, strip control characters, cap length.
  2. The pipeline wraps the sanitized text in explicit "untrusted data"
     delimiters and instructs the model it can never override the rules.
  3. Output-side grounding validation (project titles / skills must exist in
     the master resume) discards anything a successful injection could add.
"""

import re

# Phrases that try to hijack the instruction context
_INJECTION_PATTERNS = [
    r"ignore\s+(?:all\s+|any\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|rules?|prompts?)",
    r"disregard\s+(?:all\s+|any\s+)?(?:previous|prior|above|earlier|the)\s+(?:instructions?|rules?|prompts?)",
    r"forget\s+(?:all\s+|any\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|rules?)",
    r"you\s+are\s+now\s+",
    r"act\s+as\s+(?:an?\s+)?(?:system|admin|developer|jailbroken)",
    r"new\s+(?:system\s+)?instructions?\s*:",
    r"system\s*prompt",
    r"developer\s+mode",
    r"\bDAN\b",
]

# Chat-template / role-marker control tokens for common model families
_CONTROL_TOKENS = [
    r"<\|im_start\|>", r"<\|im_end\|>", r"<\|endoftext\|>", r"<\|eot_id\|>",
    r"\[INST\]", r"\[/INST\]", r"<<SYS>>", r"<</SYS>>",
    r"^\s*(?:system|assistant|user)\s*:",
]

_injection_re = re.compile("|".join(_INJECTION_PATTERNS), re.IGNORECASE)
_control_re = re.compile("|".join(_CONTROL_TOKENS), re.IGNORECASE | re.MULTILINE)


def sanitize_user_prompt(text: str, max_len: int = 500) -> str:
    """Clean free-text the user supplies as AI guidance (e.g. custom_prompt).

    Removes control characters, chat-template tokens and instruction-hijack
    phrases, collapses whitespace, and caps the length. The result is safe to
    embed as quoted DATA inside a larger prompt.
    """
    if not text:
        return ""
    cleaned = str(text)

    # Strip non-printable/control characters (keep newlines and tabs)
    cleaned = re.sub(r"[^\x20-\x7E -￿\n\t]", "", cleaned)

    cleaned = _control_re.sub(" ", cleaned)
    cleaned = _injection_re.sub("[filtered]", cleaned)

    # Backtick fences / braces can break out of prompt structure or JSON examples
    cleaned = cleaned.replace("```", "'''").replace("{", "(").replace("}", ")")

    cleaned = re.sub(r"[ \t]+", " ", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    return cleaned[:max_len]
