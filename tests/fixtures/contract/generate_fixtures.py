import os
import sys
import json

# Add ai-service to path so we can import schemas
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../app/ai-service')))

from schemas.callback import AiCallbackPayload, CallbackStatus

SECRET = "test-hmac-secret-32-chars-long!!"

payload = AiCallbackPayload(
    task_id="task-abc-123",
    delivery_id="del-xyz-456",
    timestamp="2024-03-24T10:30:00Z",
    status=CallbackStatus.COMPLETED,
    result={"score": 0.9, "prediction": "approved"},
    task_type="humanitarian_verification",
    completed_at="2024-03-24T10:35:00Z",
    error=None
)

payload_json = payload.to_json_bytes()
signature = payload.sign(SECRET)

# Write payload
with open(os.path.join(os.path.dirname(__file__), 'callback_payload.json'), 'wb') as f:
    f.write(payload_json)

# Write headers
with open(os.path.join(os.path.dirname(__file__), 'callback_headers.json'), 'w') as f:
    json.dump({
        "X-Signature-256": signature,
        "content-type": "application/json"
    }, f, indent=2)

print("Fixtures generated successfully!")
