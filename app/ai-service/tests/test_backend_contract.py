"""
Contract tests ensuring AI-service payload and HMAC signatures perfectly align
with the shared fixtures used by the backend.
"""

import json
import os
from pathlib import Path

from schemas.callback import AiCallbackPayload, CallbackStatus

# Same secret used to generate the fixtures
SECRET = "test-hmac-secret-32-chars-long!!"

FIXTURES_DIR = (
    Path(__file__).parent.parent.parent.parent / "tests" / "fixtures" / "contract"
)


def test_callback_payload_matches_fixture():
    """
    Ensure the canonical AiCallbackPayload matches the deterministic JSON fixture.
    A failure here means the AI service schema has drifted from the agreed contract.
    """
    fixture_path = FIXTURES_DIR / "callback_payload.json"
    with open(fixture_path, "rb") as f:
        fixture_bytes = f.read()

    expected_dict = json.loads(fixture_bytes)

    # Generate payload using the same data as the fixture
    payload = AiCallbackPayload(
        task_id="task-abc-123",
        delivery_id="del-xyz-456",
        timestamp="2024-03-24T10:30:00Z",
        status=CallbackStatus.COMPLETED,
        result={"score": 0.9, "prediction": "approved"},
        task_type="humanitarian_verification",
        completed_at="2024-03-24T10:35:00Z",
        error=None,
    )

    generated_dict = json.loads(payload.to_json_bytes())

    # Pytest will clearly show which field drifted if this fails
    assert generated_dict == expected_dict


def test_callback_hmac_matches_fixture():
    """
    Ensure the HMAC generation exactly matches the expected headers.
    A failure here means the signing logic or serialised payload bytes changed.
    """
    headers_path = FIXTURES_DIR / "callback_headers.json"
    with open(headers_path, "r") as f:
        expected_headers = json.load(f)

    payload = AiCallbackPayload(
        task_id="task-abc-123",
        delivery_id="del-xyz-456",
        timestamp="2024-03-24T10:30:00Z",
        status=CallbackStatus.COMPLETED,
        result={"score": 0.9, "prediction": "approved"},
        task_type="humanitarian_verification",
        completed_at="2024-03-24T10:35:00Z",
        error=None,
    )

    signature = payload.sign(SECRET)

    assert signature == expected_headers["X-Signature-256"]
