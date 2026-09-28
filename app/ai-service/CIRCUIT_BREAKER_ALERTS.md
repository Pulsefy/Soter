# Circuit Breaker Alerts

> Issue #1205 — *Add an Alert When a Circuit Breaker Opens*

The AI service wraps each LLM/OCR provider call in a
[circuit breaker](services/circuit_breaker.py). When a provider keeps failing,
the breaker trips to `OPEN` and traffic is routed to a fallback provider.

Operators could already *query* and *reset* breaker state through the admin
endpoints in [`services/admin_circuit_breaker_routes.py`](services/admin_circuit_breaker_routes.py),
but nothing told them when a breaker actually tripped — an outage was only
discovered by polling the admin endpoint or noticing degraded verification
throughput. This document describes the alert that closes that gap.

---

## 1. What triggers an alert

An alert is emitted on the two transitions an operator can act on:

| Event | Transition | Meaning |
| --- | --- | --- |
| `opened` | any state → `OPEN` | A provider is failing; the breaker is now short-circuiting calls |
| `recovered` | any state → `CLOSED` | A half-open probe succeeded (or an operator reset the breaker); the provider is serving traffic again |

`CLOSED → HALF_OPEN` probes are deliberately **not** alerted: the breaker is
already testing its own recovery, which is not operator-actionable. Every
transition, alerted or not, is still written to the service log as a
`circuit_breaker_state_transition` record.

## 2. Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `CIRCUIT_BREAKER_ALERTS_ENABLED` | `true` | Master switch. When `false`, no alerts are delivered (transitions are still logged). |
| `CIRCUIT_BREAKER_ALERT_WEBHOOK_URL` | *(unset)* | The alert sink. **Leave unset to disable delivery.** |
| `CIRCUIT_BREAKER_ALERT_DEDUP_SECONDS` | `300` | De-duplication window in seconds, applied per `(provider, event)`. `0` disables de-duplication. |
| `AI_WEBHOOK_SECRET` | *(unset)* | Shared HMAC-SHA256 secret used to sign alert bodies. When unset, alerts are delivered **unsigned** (development only) and a warning is logged. |

Alerting is off unless a webhook URL is configured, so the default
configuration never attempts an outbound call.

## 3. Payload contract

The alert body is a single JSON object (schema `1.0`), serialised in camelCase
to match the existing task-callback contract:

```json
{
  "alertType": "circuit_breaker",
  "event": "opened",
  "provider": "openai",
  "fromState": "CLOSED",
  "toState": "OPEN",
  "failureCount": 3,
  "reason": "failure_threshold_reached:3/3",
  "timestamp": "2026-09-23T10:30:00Z",
  "service": "soter-ai-service",
  "schemaVersion": "1.0"
}
```

| Field | Description |
| --- | --- |
| `alertType` | Always `circuit_breaker`; lets a shared sink route by alert kind. |
| `event` | `opened` or `recovered`. |
| `provider` | Provider whose breaker changed state (`openai`, `groq`, `test`, `tesseract`, …). |
| `fromState` / `toState` | Breaker states (`CLOSED`, `HALF_OPEN`, `OPEN`). |
| `failureCount` | Failure count recorded at the moment of the transition — the count that triggered the alert. |
| `reason` | The breaker's own reason string, e.g. `failure_threshold_reached:3/3`, `probe_succeeded`, `manual_reset_via_admin_api`. |
| `timestamp` | ISO-8601 UTC time of the transition. |
| `service` | Emitting service (`soter-ai-service`). |
| `schemaVersion` | Forward-compatibility version (`1.0`). |

### Signature

When `AI_WEBHOOK_SECRET` is set, the request carries:

```
X-Signature-256: <lowercase hex HMAC-SHA256 of the raw request body>
```

This is the same header name, algorithm, and encoding as the task-callback
webhook (see [`schemas/callback.py`](schemas/callback.py)). Verify it with
`schemas.callback.verify_hmac(raw_body, secret, signature)` **before** parsing
the body.

## 4. De-duplication

A provider that flaps (open, close, open, close, …) must not spam the channel.
Alerts are keyed by `(provider, event)`, and a repeat inside
`CIRCUIT_BREAKER_ALERT_DEDUP_SECONDS` is suppressed.

Keying per event means the **first** open *and* the **first** recovery are
still delivered even when they happen seconds apart; only the repeats are
collapsed. Concretely, with the default 300s window:

```
t+0s    open        -> alert sent      (opened)
t+5s    close       -> alert sent      (recovered)
t+10s   open        -> suppressed
t+15s   close       -> suppressed
t+320s  open        -> alert sent      (window elapsed)
```

Suppressed events are logged (`circuit_breaker_alert_suppressed`) and counted,
so the channel is quiet without losing visibility.

## 5. Delivery behaviour

- Delivery is **fire-and-forget** on a short-lived daemon thread, so an alert
  never adds latency to — or fails — the verification request that observed the
  failure.
- Failures (non-2xx response or connection error) are logged
  (`circuit_breaker_alert_delivery_failed`) and counted, never raised. Alerts
  are best-effort; the durable record of a transition remains the service log
  and the Prometheus gauge.
- A delivery failure does **not** update the de-duplication window, so a sink
  that was briefly down will receive the next transition once it recovers.

## 6. Metrics

`circuit_breaker_alerts_total{provider,event,outcome}` counts alert decisions,
where `outcome` is one of `sent`, `suppressed`, or `failed`. Labels are
bounded (provider names come from the code-defined provider registry), per the
cardinality guidance in [`metrics.py`](metrics.py).

## 7. Example receiver

```python
import os

from flask import Flask, abort, request

from schemas.callback import verify_hmac

app = Flask(__name__)
SECRET = os.environ["AI_WEBHOOK_SECRET"]


@app.post("/hooks/circuit-breaker")
def circuit_breaker_alert():
    raw = request.get_data()
    if not verify_hmac(raw, SECRET, request.headers.get("X-Signature-256", "")):
        abort(401)

    alert = request.get_json()
    if alert["event"] == "opened":
        page_on_call(
            f"Provider {alert['provider']} circuit opened after "
            f"{alert['failureCount']} failures at {alert['timestamp']}"
        )
    else:
        notify_recovered(f"Provider {alert['provider']} recovered")
    return "", 204
```

## 8. Tests

[`tests/test_circuit_breaker_alerts.py`](tests/test_circuit_breaker_alerts.py)
covers open/recovery dispatch, the payload contents, per-provider
de-duplication across the window, HMAC signing, the disabled path, and delivery
failure handling.
