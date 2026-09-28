import { ApiProperty } from '@nestjs/swagger';

class BulkReviewSuccessItem {
  @ApiProperty()
  id: string;

  @ApiProperty()
  status: string;
}

class BulkReviewFailureItem {
  @ApiProperty()
  id: string;

  @ApiProperty()
  error: string;
}

export class BulkReviewResultDto {
  @ApiProperty({ type: [BulkReviewSuccessItem] })
  succeeded: BulkReviewSuccessItem[];

  @ApiProperty({ type: [BulkReviewFailureItem] })
  failed: BulkReviewFailureItem[];
}
