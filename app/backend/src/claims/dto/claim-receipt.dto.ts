import { ApiProperty } from '@nestjs/swagger';

export class ClaimReceiptDto {
  @ApiProperty({
    description: 'Unique claim identifier',
    example: 'claim-uuid-123',
  })
  claimId: string;

  @ApiProperty({
    description: 'Campaign/package ID',
    example: 'campaign-uuid-456',
  })
  packageId: string;

  @ApiProperty({
    description: 'Current status of the claim',
    enum: [
      'requested',
      'verified',
      'approved',
      'disbursed',
      'archived',
      'cancelled',
    ],
    example: 'disbursed',
  })
  status:
    | 'requested'
    | 'verified'
    | 'approved'
    | 'disbursed'
    | 'archived'
    | 'cancelled';

  @ApiProperty({
    description: 'Token amount for the claim',
    example: 100.5,
  })
  amount: number;

  @ApiProperty({
    description: 'ISO timestamp of claim creation',
    example: '2024-01-15T10:30:00Z',
  })
  timestamp: string;

  @ApiProperty({
    description: 'Stellar token address (optional)',
    example: 'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN',
    required: false,
  })
  tokenAddress?: string;

  @ApiProperty({
    description: 'Recipient reference (optional)',
    example: 'recipient-ref-789',
    required: false,
  })
  recipientRef?: string;
}

export class ClaimShareResponseDto {
  @ApiProperty({
    description: 'Base64-encoded receipt image or data',
  })
  receiptData: string;

  @ApiProperty({
    description: 'MIME type of the receipt data',
    example: 'text/plain',
  })
  mimeType: string;

  @ApiProperty({
    description: 'Filename for download',
    example: 'claim-receipt-uuid.txt',
  })
  filename: string;

  @ApiProperty({
    description: 'Text representation of receipt for sharing',
  })
  text: string;
}

export class SendReceiptShareDto {
  @ApiProperty({
    description: 'Email address(es) to send receipt to',
    example: ['recipient@example.com'],
    isArray: true,
  })
  emailAddresses?: string[];

  @ApiProperty({
    description: 'Phone number(s) to send receipt to (SMS)',
    example: ['+1234567890'],
    isArray: true,
  })
  phoneNumbers?: string[];

  @ApiProperty({
    description: 'Channel for sharing',
    enum: ['email', 'sms', 'inline'],
    example: 'email',
  })
  channel: 'email' | 'sms' | 'inline';

  @ApiProperty({
    description: 'Custom message to include with receipt (optional)',
    required: false,
  })
  message?: string;
}
