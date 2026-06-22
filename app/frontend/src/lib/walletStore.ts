import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface WalletState {
  publicKey: string | null;
  network: string | null;
  setPublicKey: (key: string | null) => void;
  setNetwork: (network: string | null) => void;
  disconnect: () => void;
}

export const useWalletStore = create<WalletState>()(
  persist(
    (set) => ({
      publicKey: null,
      network: null,
      setPublicKey: (key) => set({ publicKey: key }),
      setNetwork: (network) => set({ network }),
      disconnect: () => set({ publicKey: null, network: null }),
    }),
    {
      name: 'wallet-storage',
      partialize: (state) => ({
        ...(state.publicKey ? { publicKey: state.publicKey } : {}),
        ...(state.network ? { network: state.network } : {}),
      }),
    }
  )
);
