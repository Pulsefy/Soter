import {
  IsString,
  IsOptional,
  IsDateString,
  IsObject,
  IsInt,
  IsPositive,
} from 'class-validator';

export class CreateDeploymentMetadataDto {
  @IsString()
  contractName: string;

  @IsString()
  network: string;

  @IsString()
  contractId: string;

  @IsString()
  wasmHash: string;

  @IsDateString()
  deployedAt: string;

  @IsOptional()
  @IsString()
  commitSha?: string;

  @IsOptional()
  @IsString()
  deployer?: string;

  @IsOptional()
  @IsString()
  transactionHash?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  contractVersion?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateDeploymentMetadataDto {
  @IsOptional()
  @IsDateString()
  deployedAt?: string;

  @IsOptional()
  @IsString()
  commitSha?: string;

  @IsOptional()
  @IsString()
  deployer?: string;

  @IsOptional()
  @IsString()
  transactionHash?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  contractVersion?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class DeploymentMetadataResponseDto {
  id: string;
  contractName: string;
  network: string;
  contractId: string;
  wasmHash: string;
  deployedAt: Date;
  commitSha?: string;
  deployer?: string;
  transactionHash?: string;
  contractVersion?: number;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export class MigrateDeploymentResponseDto {
  deployment: DeploymentMetadataResponseDto;
  previousVersion: number;
  verifiedVersion: number;
  transactionHash: string;
  migratedAt: Date;
}
