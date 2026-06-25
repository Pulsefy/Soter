import React, { useMemo } from "react";

type Props = {
  network: "testnet" | "mainnet";
};

const FAUCET_LINKS = [
  {
    label: "Stellar Laboratory Friendbot",
    href: "https://laboratory.stellar.org/#account-creator?network=test",
  },
  {
    label: "Friendbot API",
    href: "https://friendbot.stellar.org/",
  },
];

export default function TestnetFaucetHelper({
  network,
}: Props) {
  const isTestnet = useMemo(
    () => network === "testnet",
    [network]
  );

  if (!isTestnet) return null;

  return (
    <aside
      aria-label="Testnet funding helper"
      className="
        fixed bottom-4 right-4 z-40
        w-[92vw] max-w-sm
        rounded-2xl
        border border-blue-500/20
        bg-white dark:bg-neutral-900
        shadow-xl
        backdrop-blur-md
        p-4
      "
    >
      <div className="flex flex-col gap-3">
        
        {/* Header */}
        <div>
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">
            Get Testnet XLM
          </h2>

          <p className="mt-1 text-xs leading-relaxed text-neutral-600 dark:text-neutral-300">
            Use official Stellar faucet tools to fund demo wallets during testing.
          </p>
        </div>

        {/* Links */}
        <div className="flex flex-col gap-2">
          {FAUCET_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="
                rounded-lg
                border border-neutral-200 dark:border-neutral-700
                px-3 py-2
                text-xs font-medium
                text-blue-600 dark:text-blue-400
                hover:bg-neutral-50 dark:hover:bg-neutral-800
                transition-colors
              "
            >
              {link.label}
            </a>
          ))}
        </div>

        {/* Footer */}
        <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
          Visible only in testnet environments.
        </p>
      </div>
    </aside>
  );
}