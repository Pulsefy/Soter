'use client';

import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Fingerprint, ShieldAlert } from 'lucide-react';
import { useToast } from './ToastProvider';

export interface BiometricConfirmationModalProps {
  /** Whether the modal is open */
  open: boolean;
  /** Callback when modal closes */
  onOpenChange: (open: boolean) => void;
  /** Title of the confirmation */
  title?: string;
  /** Description/message to show */
  description?: string;
  /** Callback when user confirms action */
  onConfirm: () => Promise<void> | void;
  /** Callback when user cancels action */
  onCancel?: () => void;
  /** Whether biometrics are available */
  biometricAvailable?: boolean;
  /** Loading state */
  loading?: boolean;
  /** Custom confirm button text */
  confirmText?: string;
  /** Custom cancel button text */
  cancelText?: string;
  /** Whether this is a high-risk action */
  highRisk?: boolean;
}

/**
 * Reusable confirmation modal for biometric unavailable fallback.
 * 
 * When biometrics are NOT available, this modal provides a safe fallback
 * confirmation dialog for high-risk actions.
 * 
 * Follows existing Soter design system patterns.
 */
export const BiometricConfirmationModal: React.FC<BiometricConfirmationModalProps> = ({
  open,
  onOpenChange,
  title = 'Confirm Action',
  description = 'Biometric authentication is unavailable on this device. Do you want to continue?',
  onConfirm,
  onCancel,
  biometricAvailable = false,
  loading = false,
  confirmText = 'Continue',
  cancelText = 'Cancel',
  highRisk = true
}) => {
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = React.useState(false);

  const handleConfirm = async () => {
    setIsProcessing(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (error) {
      console.error('Error during confirmation action:', error);
      toast(
        'Action failed',
        error instanceof Error ? error.message : 'An error occurred',
        'error'
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCancel = () => {
    onCancel?.();
    onOpenChange(false);
  };

  const isDisabled = loading || isProcessing;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-[50%] top-[50%] z-50 w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-white p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] rounded-lg">
          <div className="flex flex-col space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {highRisk && (
                  <div className="rounded-full bg-red-100 p-2">
                    <ShieldAlert className="h-5 w-5 text-red-600" />
                  </div>
                )}
                {!highRisk && !biometricAvailable && (
                  <div className="rounded-full bg-yellow-100 p-2">
                    <Fingerprint className="h-5 w-5 text-yellow-600" />
                  </div>
                )}
                <Dialog.Title className="text-lg font-semibold leading-none tracking-tight text-gray-900">
                  {title}
                </Dialog.Title>
              </div>
              <Dialog.Close asChild>
                <button
                  className="rounded-sm opacity-70 ring-offset-white transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 disabled:pointer-events-none"
                  onClick={handleCancel}
                  disabled={isDisabled}
                >
                  <X className="h-4 w-4" />
                  <span className="sr-only">Close</span>
                </button>
              </Dialog.Close>
            </div>

            <Dialog.Description className="text-sm text-gray-500">
              {description}
            </Dialog.Description>

            {highRisk && (
              <div className="rounded-md bg-red-50 p-3 border border-red-100">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <ShieldAlert className="h-5 w-5 text-red-400" />
                  </div>
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-red-800">
                      High-Risk Action
                    </h3>
                    <div className="mt-1 text-sm text-red-700">
                      <p>
                        This action cannot be undone and may have significant consequences.
                        Please ensure you intend to perform this operation.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {!biometricAvailable && (
              <div className="rounded-md bg-yellow-50 p-3 border border-yellow-100">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <Fingerprint className="h-5 w-5 text-yellow-400" />
                  </div>
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-yellow-800">
                      Biometric Authentication Unavailable
                    </h3>
                    <div className="mt-1 text-sm text-yellow-700">
                      <p>
                        Your device does not support biometric authentication.
                        For enhanced security, consider using a device with biometric capabilities.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 pt-4">
              <button
                type="button"
                onClick={handleCancel}
                disabled={isDisabled}
                className="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium ring-offset-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-gray-300 bg-white text-gray-900 hover:bg-gray-100"
              >
                {cancelText}
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={isDisabled}
                className={`inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium ring-offset-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ${
                  highRisk
                    ? 'bg-red-600 text-white hover:bg-red-700'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {isProcessing ? (
                  <>
                    <svg
                      className="mr-2 h-4 w-4 animate-spin"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Processing...
                  </>
                ) : (
                  confirmText
                )}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};