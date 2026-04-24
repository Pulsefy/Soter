'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronLeft, Download, FileSpreadsheet, RefreshCcw, UploadCloud } from 'lucide-react';
import { useToast } from '@/components/ToastProvider';
import {
  buildValidationReport,
  confirmRecipientsImport,
  parseRecipientsCsv,
  type ParsedCsvData,
  validateRecipientsImport,
  type ValidationResult,
  type WizardStep,
} from '@/lib/csv-validation';
import { Step1Upload } from './Step1Upload';
import { Step2Preview } from './Step2Preview';
import { Step3Validation } from './Step3Validation';
import { Step4Confirm } from './Step4Confirm';

const steps: Array<{ id: WizardStep; title: string; description: string }> = [
  { id: 1, title: 'Upload', description: 'Select recipient CSV' },
  { id: 2, title: 'Preview', description: 'Review parsed rows' },
  { id: 3, title: 'Validation', description: 'Resolve import issues' },
  { id: 4, title: 'Confirm', description: 'Submit validated import' },
];

interface ImportRecipientsWizardProps {
  campaignId: string;
}

export function ImportRecipientsWizard({ campaignId }: ImportRecipientsWizardProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<WizardStep>(1);
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedCsvData | null>(null);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const summary = validationResult?.summary;
  const canAdvanceToPreview = Boolean(file && parsedData && !fileError);
  const canAdvanceToValidation = Boolean(parsedData?.rows.length);
  const canAdvanceToConfirm = Boolean(validationResult);
  const hasBlockingErrors = Boolean(summary && summary.errorRows > 0);
  const previewRows = useMemo(() => parsedData?.rows.slice(0, 12) ?? [], [parsedData]);

  async function handleFileSelected(nextFile: File | null) {
    setFile(nextFile);
    setParsedData(null);
    setValidationResult(null);
    setFileError(null);
    setSubmitMessage(null);
    setSubmitError(null);

    if (!nextFile) {
      return;
    }

    if (!nextFile.name.toLowerCase().endsWith('.csv')) {
      setFileError('Please upload a CSV file.');
      return;
    }

    setIsParsing(true);
    try {
      const data = await parseRecipientsCsv(nextFile);
      setParsedData(data);
      toast('CSV ready', `Loaded ${data.rows.length} recipient rows for review.`, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to parse the selected CSV file.';
      setFileError(message);
      toast('Upload problem', message, 'error');
    } finally {
      setIsParsing(false);
    }
  }

  async function handleRunValidation() {
    if (!file || !parsedData) {
      return;
    }

    setIsValidating(true);
    setSubmitMessage(null);
    setSubmitError(null);

    try {
      const result = await validateRecipientsImport(campaignId, file, parsedData.rows);
      setValidationResult(result);
      setStep(3);

      if (result.summary.errorRows > 0) {
        toast('Validation found issues', `${result.summary.errorRows} row(s) need correction before import.`, 'warning');
      } else {
        toast('Validation complete', `${result.summary.validRows} valid row(s) ready to import.`, 'success');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to validate this import.';
      setSubmitError(message);
      toast('Validation failed', message, 'error');
    } finally {
      setIsValidating(false);
    }
  }

  function handleDownloadReport() {
    if (!validationResult) {
      return;
    }

    const blob = buildValidationReport(validationResult);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `recipient-validation-report-${campaignId}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function handleConfirmImport() {
    if (!file) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    setSubmitMessage(null);

    try {
      const message = await confirmRecipientsImport(campaignId, file);
      setSubmitMessage(message);
      toast('Import complete', message, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to complete import.';
      setSubmitError(message);
      toast('Import failed', message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleStartOver() {
    setStep(1);
    setFile(null);
    setParsedData(null);
    setValidationResult(null);
    setFileError(null);
    setIsParsing(false);
    setIsValidating(false);
    setIsSubmitting(false);
    setSubmitMessage(null);
    setSubmitError(null);
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-white to-slate-50 px-4 py-8 dark:via-slate-950 dark:to-slate-950">
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <Link
              href="/campaigns"
              className="inline-flex items-center gap-2 text-sm text-slate-500 transition hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
            >
              <ChevronLeft className="h-4 w-4" />
              Back to campaigns
            </Link>
            <div className="space-y-1">
              <h1 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">Import recipients</h1>
              <p className="max-w-2xl text-sm text-slate-600 dark:text-slate-300">
                Upload a recipient list, inspect the parsed rows, clear validation issues, and confirm the final import for campaign <span className="font-medium text-slate-900 dark:text-slate-100">{campaignId}</span>.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {validationResult && (
              <button
                type="button"
                onClick={handleDownloadReport}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Download className="h-4 w-4" />
                Download validation report
              </button>
            )}
            <button
              type="button"
              onClick={handleStartOver}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <RefreshCcw className="h-4 w-4" />
              Start over
            </button>
          </div>
        </div>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            {step === 1 && (
              <Step1Upload
                file={file}
                fileError={fileError}
                isParsing={isParsing}
                onFileSelected={handleFileSelected}
                onNext={() => setStep(2)}
                canProceed={canAdvanceToPreview}
              />
            )}

            {step === 2 && parsedData && (
              <Step2Preview
                file={file}
                headers={parsedData.headers}
                previewRows={previewRows}
                totalRows={parsedData.rows.length}
                onBack={() => setStep(1)}
                onNext={handleRunValidation}
                isValidating={isValidating}
                canProceed={canAdvanceToValidation}
              />
            )}

            {step === 3 && parsedData && validationResult && (
              <Step3Validation
                result={validationResult}
                headers={parsedData.headers}
                onBack={() => setStep(2)}
                onNext={() => setStep(4)}
                onDownloadReport={handleDownloadReport}
                isValidating={isValidating}
                canProceed={canAdvanceToConfirm}
              />
            )}

            {step === 4 && validationResult && (
              <Step4Confirm
                result={validationResult}
                isSubmitting={isSubmitting}
                hasBlockingErrors={hasBlockingErrors}
                submitMessage={submitMessage}
                submitError={submitError}
                onBack={() => setStep(3)}
                onConfirm={handleConfirmImport}
                onStartOver={handleStartOver}
              />
            )}
          </div>

          <aside className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Progress</h2>
              <ol className="mt-4 space-y-3">
                {steps.map(item => {
                  const isActive = item.id === step;
                  const isComplete = item.id < step;

                  return (
                    <li key={item.id} className="flex items-start gap-3">
                      <div
                        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${
                          isComplete
                            ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                            : isActive
                              ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
                              : 'border-slate-300 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400'
                        }`}
                      >
                        {isComplete ? <CheckCircle2 className="h-4 w-4" /> : item.id}
                      </div>
                      <div className="space-y-1">
                        <p className={`text-sm font-medium ${isActive ? 'text-slate-900 dark:text-slate-50' : 'text-slate-700 dark:text-slate-200'}`}>{item.title}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{item.description}</p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Checklist</h2>
              <div className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
                <div className="flex items-start gap-3">
                  <UploadCloud className="mt-0.5 h-4 w-4 text-blue-600 dark:text-blue-400" />
                  <p>Upload a CSV with a header row. Common fields include name, wallet address, and phone.</p>
                </div>
                <div className="flex items-start gap-3">
                  <FileSpreadsheet className="mt-0.5 h-4 w-4 text-amber-600 dark:text-amber-400" />
                  <p>Preview shows the first 12 rows so operators can spot misaligned columns before validation.</p>
                </div>
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 text-rose-600 dark:text-rose-400" />
                  <p>Rows with errors must be fixed in the source file before import. Warnings can still be reviewed and imported.</p>
                </div>
              </div>
            </div>
          </aside>
        </section>
      </main>
    </div>
  );
}
