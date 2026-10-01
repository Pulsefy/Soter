'use client';

import * as Dialog from '@radix-ui/react-dialog';

export interface SessionExpiryWarningProps {
  isWarningVisible: boolean;
  remainingSeconds: number;
  onExtend: () => Promise<void> | void;
  onLogout: () => void;
}

/** Warns before an idle session expires; extending preserves review state. */
export function SessionExpiryWarning({
  isWarningVisible,
  remainingSeconds,
  onExtend,
  onLogout,
}: SessionExpiryWarningProps) {
  return (
    <Dialog.Root open={isWarningVisible} onOpenChange={(open) => !open && onLogout()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-lg">
          <Dialog.Title className="font-semibold">Session expiring soon</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-gray-600">
            Signing out in {remainingSeconds}s. Extend to keep your review in progress.
          </Dialog.Description>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={onLogout} className="px-3 py-1.5 text-sm text-gray-600">Log out</button>
            <button onClick={onExtend} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white">
              Extend session
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
