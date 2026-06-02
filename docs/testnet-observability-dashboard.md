# Testnet Observability Dashboard

Use the backend `/metrics`, `/health`, `/api/v1/health`, and `/jobs/health` endpoints together when Testnet behavior is unclear. Start with the request correlation ID, then check contract latency, transaction submission failures, callback failures, queue depth, and RPC health.

## Request Correlation

- Every HTTP request receives `x-correlation-id` and `x-request-id` response headers.
- Pass `x-correlation-id` on operator requests when investigating an incident.
- Onchain BullMQ jobs copy the active request correlation ID into `job.data.correlationId`, so job logs can be matched back to the API request that queued the contract action.
- Notification jobs already accept correlation IDs; use the same header value when enqueueing callbacks from request handlers.

## Metrics To Watch

| Signal | Metric | What it means |
| --- | --- | --- |
| Contract latency | `contract_call_latency_seconds{operation,status}` | Slow or failed Soroban contract operations by queue operation. Watch p95/p99 by `operation`. |
| Transaction submission failures | `tx_submission_failures_total{operation,reason}` | Transaction submission or `tx_*` failures from onchain jobs. Spikes usually mean RPC congestion, expired transactions, bad sequence state, or network mismatch. |
| Callback failures | `callback_failures_total{callback_type,reason}` | Failed AI webhooks, notification delivery jobs, and onchain job failure callbacks. |
| Onchain throughput | `onchain_operations_total{operation,adapter,status}` | Existing onchain success/failure counter by adapter. |
| Job failures | `jobs_failed_total{job_type}` | Background job failures across queues. Pair with `/jobs/health`. |
| Webhook retries | `webhook_retries_total{webhook_type,reason}` | Retry pressure for webhook delivery paths. |

## Incident Checklist

1. Find the `x-correlation-id` from the failed API response or client logs.
2. Search backend logs for that correlation ID. Follow it from the request log to any queued onchain or notification job.
3. Check `contract_call_latency_seconds` for slow `create-claim`, `disburse`, or `init-escrow` jobs.
4. Check `tx_submission_failures_total` for transaction failures. If it is increasing, compare the reason label with Stellar RPC status and the configured Testnet RPC URL.
5. Check `callback_failures_total` for failed AI task webhooks, notification delivery, or onchain job callbacks.
6. Check `/jobs/health` for waiting, active, delayed, and failed queue counts. A healthy RPC with growing queue depth points to worker capacity or Redis issues.
7. Check `/health` and `/api/v1/health` for backend, database, Redis, and Testnet RPC reachability.

## Dashboard Panels

- Contract call latency: p50, p95, p99 from `contract_call_latency_seconds` by operation and status.
- Transaction submission failures: rate of `tx_submission_failures_total` by operation and reason.
- Callback failures: rate of `callback_failures_total` by callback type and reason.
- Queue pressure: waiting, active, delayed, and failed jobs from `/jobs/status`.
- RPC health: Testnet RPC probe status from the health endpoint.
- Correlated request errors: HTTP 4xx/5xx rate grouped by route, then inspect logs by `correlationId`.
