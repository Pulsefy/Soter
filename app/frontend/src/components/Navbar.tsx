"use client";

import React from 'react';
import Link from 'next/link';
import { WalletConnect } from './WalletConnect';
import { useWalletStore } from '@/lib/walletStore';

export const Navbar: React.FC = () => {
  const { publicKey } = useWalletStore();

  return (
    <nav className="bg-gray-800 p-4 text-white">
      <div className="container mx-auto flex justify-between items-center">
        <Link href="/" className="text-xl font-bold">
          Soter
        </Link>
        <div className="flex items-center space-x-4">
          {publicKey && (
            <span className="text-sm">
              Wallet: {publicKey.substring(0, 6)}...{publicKey.substring(publicKey.length - 6)}
            </span>
          )}
          <WalletConnect />
        </div>
      </div>
    </nav>
  );
};
