import { IsString, IsOptional, IsDateString, IsObject } from 'class-validator';

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
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}
