"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { useWalletStore } from "../../lib/walletStore";
import { stellarNetwork } from "../../lib/env";
import { buildExplorerUrl } from "../../lib/explorer";
import {
  Droplet,
  RefreshCw,
  Copy,
  Check,
  ExternalLink,
  X,
  Info,
  AlertCircle,
  HelpCircle,
  Coins
} from "lucide-react";

// Horizon server endpoints based on network
const getHorizonUrl = (networkName: string | null) => {
  const net = (networkName || "testnet").toLowerCase().trim();
  if (net === "mainnet" || net === "public") {
    return "https://horizon.stellar.org";
  }
  if (net === "futurenet") {
    return "https://horizon-futurenet.stellar.org";
  }
  if (net === "standalone") {
    return "http://localhost:8000";
  }
  return "https://horizon-testnet.stellar.org";
};

// Friendbot server endpoints based on network
const getFriendbotUrl = (networkName: string | null) => {
  const net = (networkName || "testnet").toLowerCase().trim();
  if (net === "futurenet") {
    return "https://friendbot-futurenet.stellar.org";
  }
  return "https://friendbot.stellar.org";
};

// Horizon balance fetching
const fetchBalance = async (address: string, networkName: string | null) => {
  const horizonUrl = getHorizonUrl(networkName);
  const res = await fetch(`${horizonUrl}/accounts/${address}`);
  if (res.status === 404) {
    return "unfunded";
  }
  if (!res.ok) {
    throw new Error(`Failed to fetch balance: ${res.statusText}`);
  }
  const data = await res.json();
  const nativeBalance = data.balances?.find((b: any) => b.asset_type === "native");
  return nativeBalance ? nativeBalance.balance : "0.0000000";
};

// Friendbot request funding
const fundAccount = async (address: string, networkName: string | null) => {
  const friendbotUrl = getFriendbotUrl(networkName);
  const res = await fetch(`${friendbotUrl}/?addr=${address}`);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(errText || `Friendbot error: ${res.status}`);
  }
  return await res.json();
};

export default function TestnetFaucetHelper() {
  const t = useTranslations("faucet");
  const { publicKey, network } = useWalletStore();
  
  const [isOpen, setIsOpen] = useState(true);
  const [balance, setBalance] = useState<string | null>(null);
  const [isUnfunded, setIsUnfunded] = useState(false);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [fundingState, setFundingState] = useState<"idle" | "funding" | "success" | "error">("idle");
  const [fundingError, setFundingError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [copied, setCopied] = useState(false);

  // Check if current network is a testnet environment (not mainnet/public)
  const isTestnet = useMemo(() => {
    const currentNetwork = (network || stellarNetwork || "testnet").toLowerCase().trim();
    return currentNetwork !== "mainnet" && currentNetwork !== "public";
  }, [network]);

  const loadBalance = useCallback(async () => {
    if (!publicKey) {
      setBalance(null);
      setIsUnfunded(false);
      return;
    }
    setLoadingBalance(true);
    try {
      const bal = await fetchBalance(publicKey, network || stellarNetwork);
      if (bal === "unfunded") {
        setBalance("0.00");
        setIsUnfunded(true);
      } else {
        setBalance(
          Number(bal).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 7
          })
        );
        setIsUnfunded(false);
      }
      setLastRefreshed(new Date());
    } catch (err) {
      console.error("Error loading account balance from Horizon:", err);
      // Suppress setting error so UI stays clean, but log it
    } finally {
      setLoadingBalance(false);
    }
  }, [publicKey, network]);

  useEffect(() => {
    if (isTestnet && publicKey) {
      loadBalance();
    }
  }, [isTestnet, publicKey, loadBalance]);

  const handleFundAccount = async () => {
    if (!publicKey) return;
    setFundingState("funding");
    setFundingError(null);
    try {
      await fundAccount(publicKey, network || stellarNetwork);
      setFundingState("success");
      await loadBalance();
      // Auto-clear success message after a few seconds
      setTimeout(() => {
        setFundingState("idle");
      }, 5000);
    } catch (err: any) {
      console.error("Error funding account via Friendbot:", err);
      setFundingState("error");
      setFundingError(err.message || "Failed to request funds from Friendbot");
    }
  };

  const copyAddress = () => {
    if (!publicKey) return;
    navigator.clipboard.writeText(publicKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formattedTime = useMemo(() => {
    if (!lastRefreshed) return "";
    return lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }, [lastRefreshed]);

  if (!isTestnet) return null;

  // Collapsed State: Sleek, floating FAB
  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        aria-label="Open Testnet Faucet Helper"
        className="
          fixed bottom-4 right-4 z-40
          flex items-center gap-2
          px-4 py-3 rounded-full
          bg-blue-600 hover:bg-blue-700
          text-white font-medium text-xs
          shadow-lg hover:shadow-xl
          transition-all duration-300 hover:scale-105
          focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
        "
      >
        <Droplet className="w-4 h-4 animate-pulse" />
        <span>{t("title")}</span>
      </button>
    );
  }

  // Expanded State: Interactive Glassmorphic Card
  return (
    <aside
      aria-label={t("title")}
      className="
        fixed bottom-4 right-4 z-40
        w-96 max-w-[calc(100vw-2rem)]
        bg-white/95 dark:bg-slate-900/95
        backdrop-blur-md
        rounded-2xl
        border border-slate-200 dark:border-slate-800
        shadow-2xl
        overflow-hidden
        transition-all duration-300
      "
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 bg-blue-100 dark:bg-blue-900/40 rounded-lg text-blue-600 dark:text-blue-400">
            <Coins className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              {t("title")}
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {t("subtitle")}
            </p>
          </div>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg p-1 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          aria-label="Minimize faucet helper"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Main Content */}
      <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
        
        {/* Wallet & Balance Section */}
        <div className="p-3 bg-slate-50 dark:bg-slate-950/40 rounded-xl border border-slate-100 dark:border-slate-900 space-y-3">
          {!publicKey ? (
            <div className="flex gap-2 text-xs text-amber-600 dark:text-amber-400">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <p>{t("connectWallet")}</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {/* Address Row */}
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-500 dark:text-slate-400">Address</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-slate-700 dark:text-slate-300">
                    {publicKey.substring(0, 6)}...{publicKey.substring(publicKey.length - 6)}
                  </span>
                  <button
                    onClick={copyAddress}
                    title="Copy address"
                    className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 rounded transition"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* Balance Row */}
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-500 dark:text-slate-400">Balance</span>
                <div className="text-right">
                  {loadingBalance && !balance ? (
                    <span className="text-xs text-slate-400 dark:text-slate-500">Loading...</span>
                  ) : (
                    <span className="font-bold text-slate-900 dark:text-white">
                      {balance} XLM
                    </span>
                  )}
                </div>
              </div>

              {/* Activation Note (Unfunded Accounts) */}
              {isUnfunded && (
                <div className="flex gap-1.5 p-2 bg-amber-500/10 rounded-lg text-[11px] text-amber-600 dark:text-amber-400 leading-normal border border-amber-500/20">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <p>{t("unfundedAccount")}</p>
                </div>
              )}

              {/* Refreshed info & Trigger Button */}
              <div className="flex items-center justify-between pt-1 text-[10px] text-slate-400 dark:text-slate-500 border-t border-slate-100 dark:border-slate-900/60">
                <span>{lastRefreshed ? t("lastUpdated", { time: formattedTime }) : ""}</span>
                <button
                  onClick={loadBalance}
                  disabled={loadingBalance}
                  className="flex items-center gap-1 hover:text-blue-600 dark:hover:text-blue-400 transition disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${loadingBalance ? "animate-spin text-blue-500" : ""}`} />
                  <span>{t("refresh")}</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Faucet Requests Section */}
        {publicKey && (
          <div className="space-y-2">
            <button
              onClick={handleFundAccount}
              disabled={fundingState === "funding"}
              className="
                w-full flex items-center justify-center gap-2
                px-4 py-2.5 rounded-xl
                bg-blue-600 hover:bg-blue-700
                text-white text-xs font-semibold
                shadow transition duration-200
                disabled:opacity-50 disabled:cursor-not-allowed
              "
            >
              <Droplet className={`w-4 h-4 ${fundingState === "funding" ? "animate-bounce" : ""}`} />
              <span>{fundingState === "funding" ? t("requesting") : t("requestFunds")}</span>
            </button>

            {/* Success Alert */}
            {fundingState === "success" && (
              <div className="flex gap-2 p-2 bg-green-500/10 border border-green-500/20 text-green-600 dark:text-green-400 rounded-lg text-xs leading-relaxed animate-fadeIn">
                <Check className="w-4 h-4 shrink-0 text-green-500 mt-0.5" />
                <p>{t("success")}</p>
              </div>
            )}

            {/* Error Alert */}
            {fundingState === "error" && (
              <div className="flex gap-2 p-2 bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 rounded-lg text-xs leading-relaxed animate-fadeIn">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-500 mt-0.5" />
                <div className="space-y-0.5">
                  <p className="font-semibold">{t("error")}</p>
                  {fundingError && <p className="text-[10px] opacity-90">{fundingError}</p>}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step-by-Step Instructions */}
        <div className="space-y-1.5">
          <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
            <HelpCircle className="w-3.5 h-3.5 text-slate-400" />
            {t("instructionsTitle")}
          </h3>
          <ol className="list-decimal pl-4 text-[11px] leading-relaxed text-slate-600 dark:text-slate-400 space-y-1">
            <li>{t("step1")}</li>
            <li>{t("step2")}</li>
            <li>{t("step3")}</li>
          </ol>
        </div>

        {/* Faucet Links */}
        <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
          <h4 className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            {t("linksTitle")}
          </h4>
          <div className="flex flex-col gap-1.5">
            <a
              href="https://laboratory.stellar.org/#account-creator?network=test"
              target="_blank"
              rel="noopener noreferrer"
              className="
                flex items-center justify-between
                rounded-lg border border-slate-200 dark:border-slate-800
                px-3 py-2 text-xs font-medium text-blue-600 dark:text-blue-400
                hover:bg-slate-50 dark:hover:bg-slate-800/55 transition
              "
            >
              <span>Stellar Laboratory Faucet</span>
              <ExternalLink className="w-3 h-3 text-slate-400" />
            </a>
            <a
              href={`https://friendbot.stellar.org/${publicKey ? `?addr=${publicKey}` : ""}`}
              target="_blank"
              rel="noopener noreferrer"
              className="
                flex items-center justify-between
                rounded-lg border border-slate-200 dark:border-slate-800
                px-3 py-2 text-xs font-medium text-blue-600 dark:text-blue-400
                hover:bg-slate-50 dark:hover:bg-slate-800/55 transition
              "
            >
              <span>Friendbot HTTP API</span>
              <ExternalLink className="w-3 h-3 text-slate-400" />
            </a>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-2 bg-slate-50 dark:bg-slate-900/50 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[10px] text-slate-400 dark:text-slate-500">
        <span>{t("faucetNote")}</span>
        {publicKey && (
          <a
            href={buildExplorerUrl("address", publicKey)}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline hover:text-blue-500 flex items-center gap-0.5"
          >
            <span>Explorer</span>
            <ExternalLink className="w-2.5 h-2.5" />
          </a>
        )}
      </div>
    </aside>
  );
}