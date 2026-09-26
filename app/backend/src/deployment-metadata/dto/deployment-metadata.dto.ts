import {
  IsString,
  IsOptional,
  IsDateString,
  IsObject,
  IsInt,
  Min,
  Max,
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

/**
 * Body for POST /deployment-metadata/:id/migrate.
 *
 * `expectedCurrentVersion` is an optional pre-flight guard: when supplied, the
 * migration is only submitted if the chain currently reports exactly that
 * version, which makes a retry safe after a partially-completed run.
 */
export class MigrateContractDto {
  @IsInt()
  @Min(1)
  @Max(4294967295)
  newVersion: number;

  @IsOptional()
  @IsString()
  expectedCurrentVersion?: string;
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
