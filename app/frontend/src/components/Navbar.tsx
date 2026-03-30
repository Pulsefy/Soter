'use client';

import React, {useState} from 'react';
import Link from 'next/link';
import { WalletConnect } from './WalletConnect';
import { useWalletStore } from '@/lib/walletStore';
import { HealthBadge } from './HealthBadge';
import { ThemeToggle } from './ThemeToggle';
import { EnvironmentIndicator } from './EnvironmentIndicator';
import { Menu, X } from 'lucide-react';

export const Navbar: React.FC = () => {
  const { publicKey } = useWalletStore(); 
  const [isOpen, setIsOpen] = useState(false);

  return (
    <nav className="bg-white dark:bg-slate-900 text-blue-900 dark:text-slate-50 border-b border-slate-200 dark:border-slate-700 p-4">
      <div className="container mx-auto flex justify-between items-center">

        <Link href="/" className="text-xl font-bold">
          Soter
        </Link>


{/*Desktop Menu*/}
         <div className="hidden md:flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-4 flex-wrap">
          <Link href="/dashboard" className="text-sm hover:underline">
            Dashboard
          </Link>
          <Link href="/campaigns" className="text-sm hover:underline">
            Campaigns
          </Link>
          <EnvironmentIndicator />
          {publicKey && (
            <span className="text-sm">
              Wallet: {publicKey.substring(0, 6)}...
              {publicKey.substring(publicKey.length - 6)}
            </span>
          )}

          <HealthBadge />
          <ThemeToggle />
          <WalletConnect />
        </div>

        <button
          className="md:hidden text-2xl"
          aria-label="Toggle navigation menu"
          aria-expanded={isOpen}
          aria-controls="mobile-menu"
          onClick={() => setIsOpen(!isOpen)}
        >
          {isOpen ? <X size={28} /> : <Menu size={28} />}
        </button>
      </div>

{/*Mobile Menu*/}
 {isOpen && (
        <div
          id="mobile-menu"
          className="md:hidden mt-4 flex flex-col gap-4 border-t border-gray-700 pt-4"
        >
          {/* Row 1 — Environment */}
          <div className="flex items-center justify-between">
            {/*<span className="text-sm text-gray-300">Environment</span>*/}
            <EnvironmentIndicator />
          </div>

          {/* Row 2 — Wallet */}
          {publicKey && (
            <div className="flex items-center justify-between">
              {/*<span className="text-sm text-gray-300">Wallet</span>*/}
              <span className="text-sm">
                {publicKey.substring(0, 6)}...
                {publicKey.substring(publicKey.length - 6)}
              </span>
            </div>
          )}

          {/* Row 3 — Health */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-300">Status</span>
            <HealthBadge />
          </div>

          {/* Row 4 — Connect Button */}
          <div className="pt-2">
            <WalletConnect />
          </div>
        </div>
      )}
    </nav>
  );
};
