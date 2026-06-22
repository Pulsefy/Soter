# Activity Center

The Activity Center provides users with a centralized view of all pending, succeeded, and failed on-chain actions and background jobs triggered from the UI.

## Features

- **Real-time Status Tracking**: Monitor the progress of transactions and jobs
- **Persistent Storage**: Activities survive page refreshes using localStorage
- **Retry Functionality**: Failed operations can be retried directly from the center
- **Explorer Links**: Direct links to blockchain explorers for completed transactions
- **Timestamp Tracking**: All activities include creation and update timestamps
- **Status Indicators**: Clear visual indicators for pending, processing, succeeded, and failed states

## Usage

### Adding Activities

Use the `useActivity` hook to track operations:

```typescript
import { useActivity } from '@/hooks/useActivity';

function MyComponent() {
  const { trackTransaction, trackJob } = useActivity();

  const handleTransaction = async () => {
    await trackTransaction(
      'Send Payment',
      'Sending 100 USDC to recipient',
      async () => {
        // Your transaction logic here
        const result = await submitTransaction(txXDR);
        return {
          transactionHash: result.hash,
          explorerUrl: `https://stellar.expert/explorer/testnet/tx/${result.hash}`
        };
      }
    );
  };

  const handleJob = async () => {
    await trackJob(
      'Process Document',
      'Analyzing uploaded document',
      async () => {
        // Your job logic here
        return await processDocument(file);
      }
    );
  };
}
```

### Activity Types

- **Transaction**: On-chain blockchain transactions
- **Job**: Background processing tasks (verification, etc.)

### Status Flow

1. **Pending**: Activity created, waiting to start
2. **Processing**: Activity in progress
3. **Succeeded**: Activity completed successfully
4. **Failed**: Activity failed with error

## Components

### ActivityCenter

The main dropdown component that displays all activities. Includes:

- Notification badge with pending count
- Expandable list of activities
- Individual activity details (status, timestamps, errors)
- Retry buttons for failed activities
- Explorer links for transactions
- Clear completed activities option

### Activity Store

Zustand store with persistence for managing activity state:

- `addActivity()`: Add new activity
- `updateActivity()`: Update existing activity
- `removeActivity()`: Remove activity
- `clearCompleted()`: Remove all succeeded/failed activities

## Integration Points

The Activity Center is currently integrated with:

- **Evidence Verification**: Tracks AI verification jobs
- **Campaign Creation**: Tracks campaign creation jobs
- **Future**: Claim disbursement, wallet connections, etc.

## Storage

Activities are persisted in localStorage with the key `activity-storage`. Only the 50 most recent activities are kept to prevent storage bloat.

## Accessibility

- Proper ARIA labels and roles
- Keyboard navigation support
- Screen reader friendly status descriptions
- High contrast status indicators