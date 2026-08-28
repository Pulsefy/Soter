-- Add schemaVersion column to SorobanEventCorrelation table
ALTER TABLE "SorobanEventCorrelation" ADD COLUMN "schemaVersion" INTEGER;

-- Create index on schemaVersion column for performance
CREATE INDEX "SorobanEventCorrelation_schemaVersion_idx" ON "SorobanEventCorrelation"("schemaVersion");