'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { WalletConnect } from './WalletConnect';
import { EnvironmentIndicator } from './EnvironmentIndicator';
import { HealthBadge } from './HealthBadge';
import { ThemeToggle } from './ThemeToggle';
import { ActivityCenter } from './ActivityCenter';
import { LanguageSelector } from './LanguageSelector';
import { useWalletStore } from '@/lib/walletStore';
import {
  getNavigationItems,
  getUserRole,
  getUserRoleLabel,
} from '@/lib/user-role';

const linkBaseClassName =
  'rounded-full px-3 py-2 text-sm font-medium transition-colors';

function isActiveRoute(href: string, pathname: string): boolean {
  if (href === '/') {
    return pathname === '/';
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Navbar() {
  const pathname = usePathname();
  const t = useTranslations();
  const { publicKey } = useWalletStore();
  const [isOpen, setIsOpen] = useState(false);
  const userRole = getUserRole();
  const userRoleLabel = t(getUserRoleLabel(userRole));
  const navigationItems = getNavigationItems(userRole);
  const walletPreview = publicKey
    ? `${publicKey.substring(0, 6)}...${publicKey.substring(publicKey.length - 6)}`
    : null;

  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  return (
    <nav className="border-b border-slate-200 bg-white p-4 text-blue-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50">
      <div className="container mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-xl font-bold">
            Soter
          </Link>

          <div className="hidden md:flex items-center gap-2">
            {navigationItems.map(item => {
              const isActive = isActiveRoute(item.href, pathname);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={`${linkBaseClassName} ${
                    isActive
                      ? 'bg-blue-100 text-blue-900 dark:bg-slate-800 dark:text-slate-50'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-blue-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-50'
                  }`}
                >
                  {t(item.label)}
                </Link>
              );
            })}
          </div>
        </div>

        <button
          type="button"
          className="inline-flex items-center justify-center rounded-full border border-slate-200 p-2 text-slate-700 md:hidden dark:border-slate-700 dark:text-slate-200"
          aria-label="Toggle navigation menu"
          aria-expanded={isOpen}
          aria-controls="mobile-menu"
          onClick={() => setIsOpen(currentValue => !currentValue)}
        >
          {isOpen ? <X size={20} /> : <Menu size={20} />}
        </button>

        <div className="hidden md:flex items-center justify-end gap-3 flex-wrap">
          <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-blue-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
            {t('navigation.role')}: {userRoleLabel}
          </span>
          <ActivityCenter />
          <EnvironmentIndicator />
          {walletPreview && <span className="text-sm">Wallet: {walletPreview}</span>}
          <HealthBadge />
          <LanguageSelector />
          <ThemeToggle />
          <WalletConnect />
        </div>
      </div>

      {isOpen && (
        <div
          id="mobile-menu"
          className="mt-4 border-t border-slate-200 pt-4 md:hidden dark:border-slate-700"
        >
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-blue-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                {t('navigation.role')}: {userRoleLabel}
              </span>
              <ThemeToggle />
            </div>

            <div className="flex flex-col gap-2">
              {navigationItems.map(item => {
                const isActive = isActiveRoute(item.href, pathname);

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={isActive ? 'page' : undefined}
                    className={`rounded-2xl border px-4 py-3 ${
                      isActive
                        ? 'border-blue-200 bg-blue-50 text-blue-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50'
                        : 'border-slate-200 text-slate-700 dark:border-slate-700 dark:text-slate-200'
                    }`}
                  >
                    <span className="block text-sm font-semibold">{t(item.label)}</span>
                    <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                      {t(item.description)}
                    </span>
                  </Link>
                );
              })}
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-500 dark:text-slate-400">
                {t('navigation.activity')}
              </span>
              <ActivityCenter />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-500 dark:text-slate-400">
                {t('navigation.environment')}
              </span>
              <EnvironmentIndicator />
            </div>

            {walletPreview && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-slate-500 dark:text-slate-400">
                  {t('navigation.wallet')}
                </span>
                <span className="text-sm">{walletPreview}</span>
              </div>
            )}

            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-500 dark:text-slate-400">
                {t('common.status')}
              </span>
              <HealthBadge />
            </div>

            <div className="pt-2">
              <WalletConnect />
            </div>
          </div>
        </div>
      )}
      </div>
    </nav>
  );
}
