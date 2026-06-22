import tasks


def test_model_inference_includes_anonymization(monkeypatch):
    payload = {
        "data": {
            "text": "John Doe received aid in Kano State on 2025-01-15.",
        }
    }

    monkeypatch.setattr(tasks.time, "sleep", lambda _seconds: None)

    result = tasks._process_model_inference(payload)

    assert result["type"] == "model_inference"
    anonymization = result["inference"]["anonymization"]
    assert anonymization is not None
    assert "[RECIPIENT_NAME]" in anonymization["anonymized_text"]
    assert "[LOCATION]" in anonymization["anonymized_text"]
    assert "[EVENT_DATE]" in anonymization["anonymized_text"]
