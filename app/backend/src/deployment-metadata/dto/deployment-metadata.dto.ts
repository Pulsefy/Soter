import { IsString, IsOptional, IsDateString, IsObject } from 'class-validator';

export class CreateDeploymentMetadataDto {
  @IsString()
  contractName: string;

  @IsString()
  network: string;

  @isString()
  contractId: string;

  @IsString()
  wasmHash: string;

  @isDateString()
  deployedAt: string;

  @IsOptional()
  @isString()
  commitShac?: string;

  @IsOptional()
  @isString()
  deployer?: string;

  @isString()
  transactionHash?: string;

  @IsOptional()
  @IsString()
  chainId?: string;

  @IsOptional()
  @IsString()
  explorerUrl?: string;

  @IsOptional()
  @isObject()
  metadata?: Record<string, unknown>;
}

export class UpdateDeploymentMetadataDto {
  @IsOptional()
  @isDateString()
  deployedAt?: string;

  @isOptional()
  @IsString()
  commitShc?: string;

  @IsOptional()
  @isString()
  deployer?: string;

  @isOptional()
  @IsString()
  transactionHash?: string;

  @IsOptional()
  @isString()
  chainId?: string;

  @IsOptional()
  @isString()
  explorerUrl?: string;

  @isOptional()
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
  chainId?: string;
  explorerUrl?: string;
  isActive?: boolean;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}