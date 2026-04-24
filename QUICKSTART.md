# Claim Receipt Share Sheet - Quick Start Guide

## 🚀 Quick Start

This guide helps you get started with the Claim Receipt Share Sheet feature quickly.

## Setup (5 minutes)

### 1. Backend Setup

The backend is ready to use. The new endpoints are automatically available:

```bash
# Get receipt
GET /claims/:id/receipt

# Share receipt
POST /claims/:id/receipt/share
```

No additional configuration needed unless you want to enable email/SMS.

### 2. Frontend Setup

The frontend component is ready to use. Add it to any page where you need to display receipts:

```typescript
import { ClaimReceipt } from '@/components/ClaimReceipt';

export default function MyPage() {
  const claimData = {
    claimId: 'claim-123',
    packageId: 'pkg-456',
    status: 'disbursed',
    amount: 100.5,
    timestamp: new Date().toISOString(),
  };

  return <ClaimReceipt claim={claimData} />;
}
```

Or navigate to the full receipt page:
```
/claim-receipt?claimId=claim-123
```

### 3. Mobile Setup

Add the screen to your navigation:

```typescript
import { ClaimReceiptScreen } from '../screens/ClaimReceiptScreen';

// In your navigation stack
<Stack.Screen
  name="ClaimReceipt"
  component={ClaimReceiptScreen}
  options={{ title: 'Claim Receipt' }}
/>
```

Then navigate to it:
```typescript
navigation.navigate('ClaimReceipt', { claimId: 'claim-123' })
```

## Usage Examples

### Display a Receipt (Web)

```typescript
import { ClaimReceipt } from '@/components/ClaimReceipt';

export default function ReceiptPage() {
  const [claim, setClaim] = React.useState(null);

  React.useEffect(() => {
    // Fetch receipt from API
    fetch(`/api/claims/${claimId}/receipt`)
      .then(r => r.json())
      .then(setClaim);
  }, [claimId]);

  return claim ? <ClaimReceipt claim={claim} /> : <div>Loading...</div>;
}
```

### Share a Receipt

**Web (automatic with Web Share API):**
```typescript
<ClaimReceipt claim={claim} />
// User clicks "Share" button, native share sheet appears
```

**Mobile (automatic with React Native Share):**
```typescript
<ClaimReceipt claim={claim} colors={colors} />
// User taps "Share", native share sheet appears
```

**Programmatic:**
```typescript
const response = await fetch(`/api/claims/${claimId}/receipt/share`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    channel: 'email',
    emailAddresses: ['user@example.com'],
  }),
});

const result = await response.json();
// result contains base64-encoded receipt and text
```

## Common Tasks

### Task: Fetch and Display a Receipt

```typescript
async function getAndDisplayReceipt(claimId: string) {
  const response = await fetch(`/api/claims/${claimId}/receipt`);
  const receipt = await response.json();
  
  return <ClaimReceipt claim={receipt} />;
}
```

### Task: Send Receipt via Email

```typescript
async function sendReceiptByEmail(claimId: string, email: string) {
  const response = await fetch(`/api/claims/${claimId}/receipt/share`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel: 'email',
      emailAddresses: [email],
    }),
  });
  
  return response.json();
}
```

### Task: Show Receipt in a Modal (Web)

```typescript
import { ClaimReceipt } from '@/components/ClaimReceipt';

export function ReceiptModal({ claimId, onClose }) {
  const [claim, setClaim] = React.useState(null);

  React.useEffect(() => {
    fetch(`/api/claims/${claimId}/receipt`)
      .then(r => r.json())
      .then(setClaim);
  }, [claimId]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
      <div className="bg-white rounded-lg p-6 max-w-2xl">
        {claim && <ClaimReceipt claim={claim} />}
        <button onClick={onClose} className="mt-4 px-4 py-2 bg-gray-500 text-white rounded">
          Close
        </button>
      </div>
    </div>
  );
}
```

### Task: Display Receipt in Mobile Screen

```typescript
import { ClaimReceiptScreen } from '../screens/ClaimReceiptScreen';

// In your claims list
<TouchableOpacity
  onPress={() => navigation.navigate('ClaimReceipt', { claimId })}
>
  <Text>View Receipt</Text>
</TouchableOpacity>
```

## API Reference (Quick)

### GET /claims/:id/receipt

**Response:**
```json
{
  "claimId": "claim-uuid",
  "packageId": "campaign-uuid",
  "status": "disbursed",
  "amount": 150.5,
  "timestamp": "2024-01-15T10:30:00Z",
  "tokenAddress": "GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN"
}
```

### POST /claims/:id/receipt/share

**Request:**
```json
{
  "channel": "email|sms|inline",
  "emailAddresses": ["user@example.com"],
  "phoneNumbers": ["+1234567890"],
  "message": "Optional custom message"
}
```

**Response:**
```json
{
  "receiptData": "base64-encoded-text",
  "mimeType": "text/plain",
  "filename": "claim-receipt-uuid.txt",
  "text": "Receipt text here..."
}
```

## Component Props

### ClaimReceipt (Web)

```typescript
interface ClaimReceiptProps {
  claim: ClaimReceiptData;
  onShare?: () => Promise<void>;
  compact?: boolean;
}
```

### ClaimReceipt (Mobile)

```typescript
interface ClaimReceiptProps {
  claim: ClaimReceiptData;
  colors: AppColors;
  compact?: boolean;
}
```

### ClaimReceiptData (All Platforms)

```typescript
interface ClaimReceiptData {
  claimId: string;
  packageId: string;
  status: 'requested' | 'verified' | 'approved' | 'disbursed' | 'archived';
  amount: number;
  timestamp: string;
  tokenAddress?: string;
  recipientRef?: string;
}
```

## Customization

### Change Status Colors (Web)

Edit `app/frontend/src/components/ClaimReceipt.tsx`:

```typescript
const statusColors = {
  requested: 'bg-yellow-50 border-yellow-200 text-yellow-900',
  verified: 'bg-blue-50 border-blue-200 text-blue-900',
  // ... etc
};
```

### Change Status Colors (Mobile)

Edit `app/mobile/src/components/ClaimReceipt.tsx`:

```typescript
const statusColors: Record<string, { bg: string; text: string; icon: string }> = {
  requested: { bg: '#fef3c7', text: '#92400e', icon: 'clock-outline' },
  // ... etc
};
```

### Add Custom Share Handler (Web)

```typescript
async function handleCustomShare() {
  // Your custom logic here
  console.log('Sharing receipt...');
}

<ClaimReceipt 
  claim={claim}
  onShare={handleCustomShare}
/>
```

## Testing

### Test on Web
1. Navigate to `/claim-receipt?claimId=test-123`
2. Click "Share" button - should open system share sheet
3. Click "Copy" button - text should copy to clipboard
4. Click "Download" button - file should download

### Test on Mobile
1. Navigate to ClaimReceipt screen
2. Tap "Share" button - should open native share sheet
3. Tap "Copy" button - text should copy to clipboard
4. All data should display correctly

### Test API

```bash
# Get receipt
curl -X GET http://localhost:3000/api/claims/test-123/receipt \
  -H "Authorization: Bearer YOUR_TOKEN"

# Share receipt
curl -X POST http://localhost:3000/api/claims/test-123/receipt/share \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"channel": "email", "emailAddresses": ["test@example.com"]}'
```

## Troubleshooting

### "Share button does nothing"
- Ensure you're using HTTPS on web
- Check browser console for errors
- Verify device supports Web Share API

### "Copy button not working"
- Check browser permissions
- Ensure HTTPS context
- Clear browser cache

### "Download not working"
- Check browser download settings
- Ensure JavaScript is enabled
- Try a different browser

### "API returns 404"
- Verify claim ID exists
- Check API authentication token
- Ensure backend is running

## Enabling Email/SMS (Optional)

### Email (SendGrid Example)

In `app/backend/src/claims/claims.service.ts`, update `sendReceiptViaEmail()`:

```typescript
import sgMail from '@sendgrid/mail';

private async sendReceiptViaEmail(
  emailAddresses: string[],
  receipt: any,
  receiptText: string,
  message?: string,
) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);

  for (const email of emailAddresses) {
    await sgMail.send({
      to: email,
      from: 'noreply@soter.app',
      subject: 'Your Claim Receipt',
      text: receiptText,
      html: `<pre>${receiptText}</pre>`,
    });
  }
}
```

### SMS (Twilio Example)

In `app/backend/src/claims/claims.service.ts`, update `sendReceiptViaSMS()`:

```typescript
import twilio from 'twilio';

private async sendReceiptViaSMS(
  phoneNumbers: string[],
  receipt: any,
  message?: string,
) {
  const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );

  const smsText = `Claim ${receipt.claimId} - ${receipt.status} - ${receipt.amount} tokens`;

  for (const phone of phoneNumbers) {
    await client.messages.create({
      to: phone,
      from: process.env.TWILIO_PHONE_NUMBER,
      body: smsText,
    });
  }
}
```

## Need Help?

See the full documentation:
- Implementation Guide: `CLAIM_RECEIPT_IMPLEMENTATION.md`
- Summary: `IMPLEMENTATION_SUMMARY.md`

Or check the source files:
- Backend: `app/backend/src/claims/`
- Frontend: `app/frontend/src/components/ClaimReceipt.tsx`
- Mobile: `app/mobile/src/components/ClaimReceipt.tsx`
