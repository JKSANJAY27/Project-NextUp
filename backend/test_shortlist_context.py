from types import SimpleNamespace

from app.services.gmail_sync import _next_shortlist_stage, _shortlist_target_stage


def _event(intent=None, body=""):
    return SimpleNamespace(parsed_metadata={"shortlist_for": intent}, subject="", body=body)


def test_ai_shortlist_intent_selects_the_announced_round():
    assert _shortlist_target_stage("SHORTLIST", _event("ONLINE_ASSESSMENT")) == "OA"
    assert _shortlist_target_stage("SHORTLIST", _event("INTERVIEW")) == "Interview"
    assert _shortlist_target_stage("SHORTLIST", _event("OFFER")) == "Offer"


def test_vague_next_round_advances_only_one_non_offer_stage():
    assert _shortlist_target_stage("SHORTLIST", _event("NEXT_ROUND")) == "NEXT_STAGE"
    assert _next_shortlist_stage("Applied") == "OA"
    assert _next_shortlist_stage("OA") == "Interview"
    assert _next_shortlist_stage("Interview") is None


def test_unknown_shortlist_does_not_advance_a_student():
    assert _shortlist_target_stage("SHORTLIST", _event("UNKNOWN")) is None
