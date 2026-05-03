# Pull Request: Optimistic Mutation UX for Campaign Actions

## Summary

Implements optimistic mutation patterns for campaign actions (pause, resume, archive) with automatic rollback on failure, standardized toast feedback, and inline status indicators.

> **Related Issue**: Improve perceived performance for common admin actions such as pause, archive, and update workflows.

---

## Changes

### New Files

| File | Description |
|------|-------------|
| `app/frontend/src/hooks/useOptimisticCampaignMutations.ts` | Core hook with optimistic updates, rollback, and toast patterns |
| `app/frontend/src/components/InlineFeedback.tsx` | Reusable inline feedback components for mutation states |
| `app/frontend/src/hooks/TEST_PLAN.md` | Test plan document |

### Modified Files

| File | Description |
|------|-------------|
| `app/frontend/src/app/[locale]/campaigns/page.tsx` | Integrated `InlineFeedback` and `OptimisticStatusBadge` components |

---

## This PR (v2) - Inline Feedback Integration

### Code Changes

```typescript
// Added imports (line 10)
import { InlineFeedback, OptimisticStatusBadge } from '@/components/InlineFeedback';

// Replaced static status badge with optimistic version
<OptimisticStatusBadge
  status={campaign.status}
  isOptimistic={campaignAction.isPending && campaignAction.variables?.id === campaign.id}
/>

// Added conditional inline feedback during mutations
{campaignAction.isPending && campaignAction.variables?.id === campaign.id ? (
  <InlineFeedback
    isPending={true}
    action={campaignAction.variables?.action.type === 'pause' ? 'pausing' : ...}
  />
) : (
  // Original buttons
)}
```

### Requirements Fulfilled

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| Optimistic state updates | ✅ | `useOptimisticCampaignAction` hook with `onMutate` callback |
| Rollback on failure | ✅ | `onError` restores previous campaign state from snapshot |
| Standardized toast patterns | ✅ | `ToastProvider` with consistent success/error messages |
| Inline feedback on mutations | ✅ | `InlineFeedback` component shown during pending state |
| Optimistic status badge | ✅ | `OptimisticStatusBadge` with animated pulse indicator |

---

## API

### Hooks

```typescript
// Unified hook for all campaign actions
const { mutate: performAction, isPending } = useCampaignAction();

// Convenience hooks
const { mutate: pauseCampaign } = usePauseCampaign();
const { mutate: resumeCampaign } = useResumeCampaign();
const { mutate: archiveCampaign } = useArchiveCampaign();

// Check available actions based on current status
const { canPause, canResume, canArchive } = useCampaignActions('active');
```

### Usage

```typescript
// Pause a campaign
performAction({
  id: 'campaign-123',
  name: 'Emergency Fund',
  action: { type: 'pause', targetStatus: 'paused' }
});

// Resume a campaign
performAction({
  id: 'campaign-123',
  name: 'Emergency Fund', 
  action: { type: 'resume', targetStatus: 'active' }
});

// Archive a campaign
performAction({
  id: 'campaign-123',
  name: 'Emergency Fund',
  action: { type: 'archive', targetStatus: 'archived' }
});
```

---

## Testing

### Manual Test Steps

1. **Optimistic Update Test**
   - Navigate to `/campaigns`
   - Click **Pause** on an active campaign
   - Verify: Status changes immediately to "paused"
   - Verify: Toast appears "Campaign paused"

2. **Rollback Test**
   - Trigger a pause action
   - Disconnect network or stop backend
   - Verify: UI reverts to previous "active" status
   - Verify: Error toast appears

3. **Archive Test**
   - Click **Archive** on a campaign
   - Verify: Campaign disappears from active list immediately
   - Verify: Success toast appears

### Run Tests

```bash
cd app
pnpm --filter frontend test
```

---

## Screenshots

### Before (No Optimistic Updates)
```
User clicks "Pause" → [Loading spinner] → 2s delay → UI updates
```

### After (With Optimistic Updates)
```
User clicks "Pause" → UI updates immediately → Background API call → Toast on completion
```

---

## User Experience Comparison

### Before
- User clicks "Pause" → UI freezes until server responds
- No visual feedback on which campaign is being mutated
- Static status badge until page refetches

### After
- User clicks "Pause" → Status badge immediately shows "paused" with pulsing indicator
- Buttons replaced with "Pausing campaign..." inline spinner
- Success toast appears on completion
- On failure: UI rolls back to previous state + error toast

```
Before:                          After:
┌─────────────────────────┐     ┌─────────────────────────┐
│ Campaign Name            │     │ Campaign Name            │
│ Status: active           │     │ Status: ⏸ paused       │
│ [Pause] [Archive]        │     │ ⟳ Pausing campaign...   │
└─────────────────────────┘     └─────────────────────────┘
                                  (pulsing indicator)
```

---

## Checklist

- [x] TypeScript compiles without errors
- [x] Optimistic updates work for pause/resume/archive
- [x] Rollback restores previous state on API failure
- [x] Toast notifications appear on success/error
- [x] Inline feedback shows during pending mutations
- [x] Optimistic status badge shows pulsing indicator
- [x] No backend changes required — uses existing infrastructure

---

## Related Files

- [useOptimisticCampaignMutations.ts](app/frontend/src/hooks/useOptimisticCampaignMutations.ts) — Core optimistic mutation logic
- [InlineFeedback.tsx](app/frontend/src/components/InlineFeedback.tsx) — Feedback components
- [ToastProvider.tsx](app/frontend/src/components/ToastProvider.tsx) — Toast notification system
- [campaigns/page.tsx](app/frontend/src/app/[locale]/campaigns/page.tsx) — Updated campaigns page

---

## Checklist

- [x] Optimistic state updates for safe campaign mutations
- [x] Roll back UI state cleanly when backend rejects a mutation
- [x] Standardize toast and inline feedback patterns
- [x] TypeScript types for all actions
- [x] Unit tests for hook behavior
- [x] Test plan documentation

---

## Related PRs

- #XXX - Backend campaign status endpoints
- #XXX - ToastProvider implementation

---

## Notes

- Uses existing `@tanstack/react-query` infrastructure
- Compatible with current `useCampaigns` hook patterns
- No breaking changes to existing API
- Follows project's React patterns and conventions