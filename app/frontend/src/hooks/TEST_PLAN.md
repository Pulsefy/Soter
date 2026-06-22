# Optimistic Mutation UX - Test Plan

## Overview
This document outlines the test plan for verifying the Optimistic Mutation UX implementation for Campaign Actions in the Soter project.

## Requirements Tested

### 1. Optimistic State Updates ✅
- **Requirement**: Add optimistic state updates for safe campaign mutations
- **Implementation**: [useOptimisticCampaignMutations.ts](app/frontend/src/hooks/useOptimisticCampaignMutations.ts)
- **Test**: UI updates immediately when user clicks Pause/Resume/Archive

### 2. Rollback on Failure ✅
- **Requirement**: Roll back UI state cleanly when the backend rejects a mutation
- **Implementation**: `onError` callback in the mutation hook restores previous state
- **Test**: Simulate API failure and verify UI reverts to previous status

### 3. Standardized Toast Patterns ✅
- **Requirement**: Standardize toast and inline feedback patterns across mutation-heavy screens
- **Implementation**: Consistent toast messages for success/error states
- **Test**: Verify toast appears with correct message and type

---

## Manual Test Steps

### Test 1: Optimistic Update on Pause/Resume

**Prerequisites**:
- Backend running at `http://localhost:4000`
- Frontend running at `http://localhost:3000`
- At least one active campaign exists

**Steps**:
1. Navigate to `/campaigns`
2. Locate an active campaign card
3. Click the **Pause** button
4. **Expected**: Status badge changes to "paused" immediately (before server response)
5. **Expected**: Toast notification appears: "Campaign paused - [Campaign Name] has been paused."

**Verification**:
```bash
# Check that the status changed optimistically
grep -A5 "campaign.id" campaigns-page.tsx | grep "status"
# Should show: status: 'paused' (optimistic)
```

### Test 2: Rollback on API Failure

**Steps**:
1. Start a pause/resume action
2. While pending, disconnect network or stop backend temporarily
3. Let the request fail
4. **Expected**: UI reverts to previous status
5. **Expected**: Error toast appears: "Failed to pause campaign - [error message]"

**Verification**:
```typescript
// Check rollback logic in hook
onError: (error, variables, context) => {
  if (context?.previousCampaigns) {
    queryClient.setQueryData(['campaigns'], context.previousCampaigns);
  }
}
```

### Test 3: Archive Action

**Steps**:
1. Click **Archive** on an active/paused campaign
2. **Expected**: Campaign disappears from active list immediately
3. **Expected**: Success toast: "Campaign archived - [Name] has been archived."

### Test 4: Concurrent Actions

**Steps**:
1. Click Pause on Campaign A
2. Immediately click Archive on Campaign B (before first completes)
3. **Expected**: Both actions proceed independently
4. **Expected**: Each gets its own toast notification

---

## Automated Test Cases

### Unit Tests for Hook

```typescript
// filepath: app/frontend/src/hooks/__tests__/testOptimisticCampaignMutations.ts
import { renderHook, waitFor } from '@testing-library/react';
import { useCampaignAction, useCampaignActions } from '../useOptimisticCampaignMutations';

describe('useCampaignAction', () => {
  it('should update optimistic state immediately', async () => {
    const { result } = renderHook(() => useCampaignAction());
    
    // Trigger mutation
    result.current.mutate({
      id: 'campaign-1',
      name: 'Test Campaign',
      action: { type: 'pause', targetStatus: 'paused' }
    });
    
    // Verify optimistic update
    expect(queryClient.getQueryData(['campaigns'])?.[0].status).toBe('paused');
  });

  it('should rollback on error', async () => {
    // Mock API to fail
    mockApi.patch.mockRejectedValue(new Error('Network error'));
    
    const { result } = renderHook(() => useCampaignAction());
    
    await act(async () => {
      try {
        result.current.mutate({
          id: 'campaign-1',
          name: 'Test Campaign',
          action: { type: 'pause', targetStatus: 'paused' }
        });
      } catch {}
    });
    
    // Verify rollback
    expect(queryClient.getQueryData(['campaigns'])?.[0].status).toBe('active');
  });
});

describe('useCampaignActions', () => {
  it('should return correct action availability for active status', () => {
    const { result } = renderHook(() => useCampaignActions('active'));
    
    expect(result.current.canPause).toBe(true);
    expect(result.current.canResume).toBe(false);
    expect(result.current.canArchive).toBe(true);
  });

  it('should return correct action availability for paused status', () => {
    const { result } = renderHook(() => useCampaignActions('paused'));
    
    expect(result.current.canPause).toBe(false);
    expect(result.current.canResume).toBe(true);
    expect(result.current.canArchive).toBe(true);
  });
});
```

---

## Success Criteria

| Criterion | Status | Notes |
|-----------|--------|-------|
| Optimistic UI update | ✅ | Status changes immediately on click |
| Rollback on failure | ✅ | Previous state restored on error |
| Toast feedback | ✅ | Success/error toasts appear |
| Type safety | ✅ | TypeScript types for all actions |
| Hook exports | ✅ | `useCampaignAction`, `usePauseCampaign`, `useResumeCampaign`, `useArchiveCampaign` |
| Action availability | ✅ | `useCampaignActions` helper for UI conditional rendering |

---

## Files Modified

| File | Change |
|------|--------|
| [useOptimisticCampaignMutations.ts](app/frontend/src/hooks/useOptimisticCampaignMutations.ts) | New file - optimistic mutation hooks |
| [campaigns/page.tsx](app/frontend/src/app/[locale]/campaigns/page.tsx) | Updated to use new hooks |

---

## Run Tests

```bash
# From monorepo root
cd app

# Run frontend tests
pnpm --filter frontend test

# Or run specific test file
pnpm --filter frontend test -- --testPathPattern="optimistic"
```