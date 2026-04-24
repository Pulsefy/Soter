# Claim Receipt Share Sheet - Implementation Guide

## Overview

The Claim Receipt Share Sheet feature (#296) provides recipients and NGO operators with a simple, shareable proof that a claim or verification step was completed. This feature is implemented across all platforms: backend, frontend web, and mobile app.

## Features

### Core Features
- **Receipt Generation**: Automatically generate formatted receipts for any claim
- **Multi-Platform Support**: Works on web (browser Web Share API) and native mobile (iOS/Android Share Sheet)
- **Share Methods**:
  - **Native Share**: Share directly to messages, email, social media via native share sheet
  - **Copy to Clipboard**: Copy receipt text for manual sharing
  - **Download**: Download receipt as a text file
- **Email Integration**: Send receipts via email (API endpoint provided)
- **SMS Integration**: Send receipts via SMS (API endpoint provided)

### Receipt Contents
Each receipt includes:
- **Claim ID**: Unique identifier for the claim
- **Package ID**: Campaign/package identifier
- **Status**: Current claim status (requested, verified, approved, disbursed, archived)
- **Amount**: Token amount for the claim
- **Timestamp**: Claim creation date and time
- **Token Address**: Stellar token address (optional)
- **Recipient Reference**: Recipient identifier (optional)

## Architecture

### Backend (NestJS)

#### New API Endpoints

**1. Get Claim Receipt**
```
GET /claims/:id/receipt
```
Returns a structured receipt DTO for the claim.

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

**2. Share Claim Receipt**
```
POST /claims/:id/receipt/share
```
Generates and optionally sends the receipt via email or SMS.

**Request:**
```json
{
  "channel": "email",
  "emailAddresses": ["recipient@example.com"],
  "message": "Here is your claim receipt"
}
```

**Response:**
```json
{
  "receiptData": "base64-encoded-receipt",
  "mimeType": "text/plain",
  "filename": "claim-receipt-uuid.txt",
  "text": "formatted-receipt-text"
}
```

#### DTOs

**ClaimReceiptDto** (`app/backend/src/claims/dto/claim-receipt.dto.ts`)
- Defines the receipt data structure
- Includes all receipt fields
- Used by the API response

**ClaimShareResponseDto**
- Contains base64-encoded receipt data
- Includes MIME type and filename
- Provides plaintext representation for sharing

**SendReceiptShareDto**
- Request body for share endpoint
- Specifies channel (email, sms, inline)
- Includes destination addresses and optional message

#### Service Methods

**getReceipt(id: string)**
- Fetches claim data
- Constructs ClaimReceiptDto
- Returns structured receipt

**shareReceipt(id: string, shareDto: SendReceiptShareDto)**
- Generates receipt text
- Handles different sharing channels
- Returns shareable receipt data

**generateReceiptText(receipt: any): string**
- Formats receipt as human-readable text
- Includes header and footer
- Supports optional fields

**sendReceiptViaEmail(addresses, receipt, text, message?)**
- Stub implementation for email sending
- Ready for integration with SendGrid, AWS SES, etc.
- Logs email requests

**sendReceiptViaSMS(numbers, receipt, message?)**
- Stub implementation for SMS sending
- Ready for integration with Twilio, AWS SNS, etc.
- Includes summary text for SMS format

### Frontend (Next.js/React)

#### Components

**ClaimReceipt** (`app/frontend/src/components/ClaimReceipt.tsx`)
- React component for displaying claim receipts
- Two display modes: full and compact
- Interactive actions: Share, Copy, Download

**Features:**
- Status-based color coding
- Responsive design
- Copy-to-clipboard functionality
- Browser Web Share API integration
- File download capability

**Props:**
```typescript
interface ClaimReceiptProps {
  claim: ClaimReceiptData;
  onShare?: () => Promise<void>;  // Custom share handler
  compact?: boolean;               // Show compact version
}
```

#### Pages

**Claim Receipt Page** (`app/frontend/src/app/claim-receipt/page.tsx`)
- Full-page view for claim receipts
- Displays receipt with additional information
- Navigation and error handling
- Help section for users

**Usage:**
```
/claim-receipt?claimId=<claimId>
```

#### Type Definitions

```typescript
interface ClaimReceiptData {
  claimId: string;
  packageId: string;
  status: 'requested' | 'verified' | 'approved' | 'disbursed' | 'archived';
  amount: number;
  tokenAddress?: string;
  timestamp: string;
  recipientRef?: string;
}
```

### Mobile (React Native/Expo)

#### Components

**ClaimReceipt** (`app/mobile/src/components/ClaimReceipt.tsx`)
- React Native component for mobile devices
- Native Share Sheet integration
- Clipboard support
- Platform-aware UI

**Features:**
- iOS/Android native share sheet
- Material Design icons
- Clipboard integration
- Responsive layout

**Props:**
```typescript
interface ClaimReceiptProps {
  claim: ClaimReceiptData;
  colors: AppColors;
  compact?: boolean;
}
```

#### Screens

**Claim Receipt Screen** (`app/mobile/src/screens/ClaimReceiptScreen.tsx`)
- Full-screen receipt display
- Header with icon
- Help section explaining functionality
- Error handling and loading states

**Navigation:**
```typescript
navigation.navigate('ClaimReceipt', { claimId: 'claim-uuid' })
```

#### Navigation Integration

Add to navigation types (`app/mobile/src/navigation/types.ts`):
```typescript
ClaimReceipt: { claimId: string };
```

Add to navigation stack (e.g., in RootNavigator):
```typescript
<Stack.Screen
  name="ClaimReceipt"
  component={ClaimReceiptScreen}
  options={{ title: 'Claim Receipt' }}
/>
```

## Integration Guide

### Backend Integration

1. **Import DTOs** in your claims controller:
```typescript
import {
  ClaimReceiptDto,
  ClaimShareResponseDto,
  SendReceiptShareDto,
} from './dto/claim-receipt.dto';
```

2. **Use the new endpoints**:
```typescript
// Get receipt
const receipt = await claimsService.getReceipt(claimId);

// Share receipt
const shareResult = await claimsService.shareReceipt(claimId, {
  channel: 'email',
  emailAddresses: ['recipient@example.com'],
});
```

3. **Integrate Email/SMS Services**:
- Replace stub implementations in `sendReceiptViaEmail()` and `sendReceiptViaSMS()`
- Add your preferred service (SendGrid, Twilio, etc.)
- Update configuration and environment variables

### Frontend Integration

1. **Import the component**:
```typescript
import { ClaimReceipt } from '@/components/ClaimReceipt';
```

2. **Use in your page**:
```typescript
<ClaimReceipt claim={claimData} onShare={handleShare} />
```

3. **Fetch data from API**:
```typescript
const response = await fetch(`/api/claims/${claimId}/receipt`);
const claim = await response.json();
```

### Mobile Integration

1. **Add to navigation**:
```typescript
import { ClaimReceiptScreen } from '../screens/ClaimReceiptScreen';

<Stack.Screen name="ClaimReceipt" component={ClaimReceiptScreen} />
```

2. **Navigate to receipt**:
```typescript
navigation.navigate('ClaimReceipt', { claimId: 'claim-uuid' })
```

3. **Fetch data from API**:
```typescript
const response = await fetch(`/api/claims/${claimId}/receipt`);
const data = await response.json();
```

## Styling & Customization

### Status Colors

Receipts use color-coded status indicators:
- **Requested**: Yellow (pending)
- **Verified**: Blue (verified)
- **Approved**: Green (approved)
- **Disbursed**: Emerald (completed)
- **Archived**: Gray (archived)

### Theme Integration

Components integrate with existing theme systems:
- **Frontend**: Uses Tailwind CSS dark mode
- **Mobile**: Uses theme context with AppColors

### Customization

Modify status colors in component definitions:
```typescript
const statusColors = {
  requested: 'bg-yellow-50 border-yellow-200 text-yellow-900',
  // ... other statuses
};
```

## Usage Examples

### Web Frontend

```typescript
// Display claim receipt
<ClaimReceipt 
  claim={claimData}
  compact={false}
  onShare={async () => {
    // Custom share logic
    await navigator.share({...})
  }}
/>
```

### Mobile App

```typescript
// Navigate to receipt screen
function handleViewReceipt(claimId: string) {
  navigation.navigate('ClaimReceipt', { claimId });
}
```

### Backend API

```bash
# Get receipt
curl -X GET https://api.soter.app/claims/claim-123/receipt \
  -H "Authorization: Bearer TOKEN"

# Share receipt via email
curl -X POST https://api.soter.app/claims/claim-123/receipt/share \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "email",
    "emailAddresses": ["user@example.com"],
    "message": "Here is your claim receipt"
  }'
```

## Testing

### Manual Testing Checklist

#### Frontend
- [ ] Receipt displays correctly with all data
- [ ] Copy button copies text to clipboard
- [ ] Download button saves file locally
- [ ] Share button opens native share sheet
- [ ] Responsive design works on mobile browsers
- [ ] Dark mode displays correctly
- [ ] Error states display properly

#### Mobile
- [ ] Receipt screen navigates correctly
- [ ] Share Sheet appears on share button press
- [ ] Copy to clipboard works
- [ ] All data displays correctly
- [ ] Loading state appears
- [ ] Error handling works
- [ ] Works on iOS and Android

#### Backend
- [ ] GET /claims/:id/receipt returns correct data
- [ ] POST /claims/:id/receipt/share processes request
- [ ] Email channel logs correctly
- [ ] SMS channel logs correctly
- [ ] Audit logging records share actions
- [ ] Error handling for invalid claims

## Future Enhancements

### Potential Features

1. **Digital Signatures**
   - Sign receipts with private keys
   - Verify receipt authenticity
   - Blockchain-backed verification

2. **QR Codes**
   - Generate QR codes for receipts
   - Easy sharing via QR
   - Offline verification capability

3. **Multi-Language Support**
   - Localize receipt text
   - Support multiple languages
   - Regional formatting

4. **Receipt Verification**
   - Online receipt verification
   - Time-limited verification links
   - Recipient confirmation tracking

5. **Batch Receipt Generation**
   - Export multiple receipts
   - Bulk email/SMS sending
   - Report generation

6. **Rich Receipt Formats**
   - PDF receipt generation
   - HTML templates
   - Custom branding

## Troubleshooting

### Common Issues

**Share button not working**
- Check browser support for Web Share API
- Ensure secure context (HTTPS)
- Verify device has share capabilities

**Copy to clipboard fails**
- Check clipboard permissions
- Ensure HTTPS context on web
- Verify user interaction context

**Email/SMS not sending (stub)**
- Integrate actual email/SMS service
- Configure service credentials
- Add error handling

## Dependencies

### Frontend
- `lucide-react` (icons)
- `date-fns` (date formatting)
- Next.js 14+

### Mobile
- `react-native`
- `expo`
- `@expo/vector-icons` (icons)
- `@react-navigation/native` (navigation)

### Backend
- `@nestjs/common`
- `@nestjs/swagger`
- `@prisma/client`

## References

- [Web Share API](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share)
- [React Native Share](https://reactnative.dev/docs/share)
- [Clipboard API](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API)
