import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface WalletState {
  publicKey: string | null;
  setPublicKey: (key: string | null) => void;
  disconnect: () => void;
}

export const useWalletStore = create<WalletState>()(
  persist(
    (set) => ({
      publicKey: null,
      setPublicKey: (key) => set({ publicKey: key }),
      disconnect: () => set({ publicKey: null }),
    }),
    {
      name: 'wallet-storage',
      partialize: (state) =>
        state.publicKey ? { publicKey: state.publicKey } : {},
    }
  )
);
