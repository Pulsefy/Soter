-- Persist optional AI/on-chain correlation metadata for new verification results.
ALTER TABLE "VerificationRequest" ADD COLUMN "anchor_metadata" JSONB;
ALTER TABLE "Claim" ADD COLUMN "anchor_metadata" JSONB;
