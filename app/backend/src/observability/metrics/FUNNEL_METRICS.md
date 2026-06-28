# Funnel Stage Metrics Documentation

## Overview

This document describes the funnel stage metrics exported for testnet dashboards. These metrics track the progression of claims through the verification and disbursement pipeline.

## Metrics

### 1. `app_claims_funnel_stage_total`

**Type:** Counter  
**Description:** Total number of claims that have entered each funnel stage (cumulative)  
**Labels:**
- `stage`: The funnel stage name (created, verified, approved, disbursed)
- `campaign_id`: The ID of the campaign the claim belongs to

**Example Prometheus Query:**
```promql
app_claims_funnel_stage_total{stage="created"}
```

**Use Cases:**
- Track total volume of claims at each stage over time
- Calculate conversion rates between stages
- Monitor overall system throughput

---

### 2. `app_claims_funnel_stage_current`

**Type:** Gauge  
**Description:** Current number of claims at each funnel stage (point-in-time)  
**Labels:**
- `stage`: The funnel stage name (created, verified, approved, disbursed)
- `campaign_id`: The ID of the campaign the claim belongs to

**Example Prometheus Query:**
```promql
app_claims_funnel_stage_current{stage="verified"}
```

**Use Cases:**
- Monitor current backlog at each stage
- Detect bottlenecks in the pipeline
- Track real-time system state

---

## Funnel Stages

| Stage | Description | Database Status |
|-------|-------------|-----------------|
| `created` | Claim has been created and is awaiting verification | `requested` |
| `verified` | Claim has passed verification (manual or AI) | `verified` |
| `approved` | Claim has been approved for disbursement | `approved` |
| `disbursed` | Funds have been disbursed to the recipient | `disbursed` |

## Dashboard Queries

### Funnel Visualization
```promql
# Current counts by stage
app_claims_funnel_stage_current

# Conversion rate: verified / created
rate(app_claims_funnel_stage_total{stage="verified"}[5m]) 
/ 
rate(app_claims_funnel_stage_total{stage="created"}[5m])

# Conversion rate: approved / verified
rate(app_claims_funnel_stage_total{stage="approved"}[5m]) 
/ 
rate(app_claims_funnel_stage_total{stage="verified"}[5m])

# Conversion rate: disbursed / approved
rate(app_claims_funnel_stage_total{stage="disbursed"}[5m]) 
/ 
rate(app_claims_funnel_stage_total{stage="approved"}[5m])
```

### Time in Stage (Approximation)
```promql
# Rate of claims entering each stage
rate(app_claims_funnel_stage_total[5m])
```

### Campaign-Specific Analysis
```promql
# Funnel for specific campaign
app_claims_funnel_stage_current{campaign_id="<campaign-id>"}

# Compare campaigns
app_claims_funnel_stage_current
```

## Implementation Notes

- **Counter metrics** are incremented when a claim transitions to a new stage
- **Gauge metrics** are refreshed periodically via `MetricsService.refreshFunnelStageGauges()`
- Metrics are automatically exported via the existing Prometheus endpoint at `/metrics`
- All metrics are prefixed with `app_` as configured in `MetricsModule`

## Refresh Strategy

The gauge metrics should be refreshed periodically to ensure they reflect the current state of the database. This can be done via:

1. **Scheduled Job:** Create a cron job that calls `metricsService.refreshFunnelStageGauges(prisma)` every minute
2. **On-Demand:** Call the refresh method after bulk operations
3. **Startup:** Call the refresh method when the application starts

Example implementation:
```typescript
@Cron('*/1 * * * *') // Every minute
async refreshMetrics() {
  await this.metricsService.refreshFunnelStageGauges(this.prisma);
}
```

## Testing

To verify metrics are working:

1. Create a claim - should increment `stage="created"`
2. Verify the claim - should increment `stage="verified"`
3. Approve the claim - should increment `stage="approved"`
4. Disburse the claim - should increment `stage="disbursed"`
5. Check `/metrics` endpoint to see the exported values
