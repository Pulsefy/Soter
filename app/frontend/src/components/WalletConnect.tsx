"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { isConnected, setAllowed, getAddress, getNetworkDetails } from "@stellar/freighter-api";
import { useWalletStore } from "../lib/walletStore";
import { useToast } from "./ToastProvider";
import { ErrorInline } from "./ErrorInline";
import { useNetworkGuard } from "../hooks/useNetworkGuard";
import { buildExplorerUrl } from "../lib/explorer";
import { ExternalLink } from "lucide-react";

export const WalletConnect: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { publicKey, setPublicKey, network, setNetwork, disconnect } = useWalletStore();
  const [mounted, setMounted] = useState(false);
  const { toast } = useToast();
  const { isMismatch } = useNetworkGuard();

  // Keep track of previous public key to avoid infinite toast loops and state updates
  const prevPublicKeyRef = useRef<string | null>(publicKey);

  const fetchNetwork = useCallback(async () => {
    try {
      const netDetails = await getNetworkDetails();
      if (typeof netDetails === 'object' && netDetails !== null && 'network' in netDetails) {
        setNetwork(netDetails.network as string);
      } else if (typeof netDetails === 'string') {
        setNetwork(netDetails);
      }
    } catch (e) {
      console.error("Error fetching network details:", e);
    }
  }, [setNetwork]);

  const checkConnection = useCallback(async () => {
    try {
      const freighterStatus = await isConnected();
      const isActuallyConnected = typeof freighterStatus === 'object' && freighterStatus !== null && 'isConnected' in freighterStatus
        ? freighterStatus.isConnected
        : freighterStatus;

      if (isActuallyConnected) {
        const pubKeyRaw = await getAddress();
        const addressStr = pubKeyRaw && typeof pubKeyRaw === 'object' && 'address' in pubKeyRaw
          ? pubKeyRaw.address
          : pubKeyRaw;

        if (addressStr && typeof addressStr === 'string') {
          if (prevPublicKeyRef.current !== addressStr) {
            setPublicKey(addressStr);
            prevPublicKeyRef.current = addressStr;

            // Only toast if it's changing from another account, or if it wasn't connected locally but Freighter was already connected
            if (prevPublicKeyRef.current !== null) {
              toast("Account Changed", `Switched to ${addressStr.substring(0, 4)}...${addressStr.substring(addressStr.length - 4)}`, "info");
            }
          }
          await fetchNetwork();
        } else {
          if (publicKey) {
            setPublicKey(null);
            prevPublicKeyRef.current = null;
            toast("Disconnected", "Wallet connection lost", "warning");
          }
        }
      } else if (publicKey) {
        setPublicKey(null);
        prevPublicKeyRef.current = null;
        toast("Disconnected", "Wallet was disconnected from Freighter", "warning");
      }
    } catch (e) {
      console.error("Error checking Freighter connection:", e);
    }
  }, [publicKey, setPublicKey, fetchNetwork, toast]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    if (typeof window === "undefined" || !('FreighterApi' in window)) {
      console.warn("Freighter is not installed or available in the browser.");
    } else {
      checkConnection();

      // Polling for account or network changes since Freighter API v6 doesn't export event listeners
      const interval = setInterval(() => {
        checkConnection();
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [checkConnection]);

  const connectWallet = async () => {
    setLoading(true);
    setError(null);
    try {
      await setAllowed();
      const pubKey = await getAddress();
      const addressStr = typeof pubKey === 'object' ? pubKey.address : pubKey;

      if (addressStr) {
        setPublicKey(addressStr);
        prevPublicKeyRef.current = addressStr;
        await fetchNetwork();
        toast("Wallet Connected", "Successfully connected to Freighter", "success");
      } else {
        throw new Error("No address returned");
      }
    } catch (err: unknown) {
      console.error("Error connecting to Freighter:", err);
      let errMsg = "Something went wrong. Please try connecting again.";
      if (err === "User declined" || (err && typeof err === "object" && "message" in err && String((err as Record<string, unknown>).message).includes("User declined"))) {
        errMsg = "Connection cancelled by user.";
        toast("Connection Rejected", errMsg, "error");
      } else {
        toast("Connection Error", errMsg, "error");
      }
      setError(errMsg);
      setPublicKey(null);
      prevPublicKeyRef.current = null;
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = () => {
    disconnect();
    prevPublicKeyRef.current = null;
    toast("Disconnected", "Wallet has been disconnected", "info");
  };

  if (!mounted) return null;

  if (loading) {
    return (
      <button className="px-4 py-2 rounded-md bg-gray-700 text-white opacity-70 cursor-not-allowed" disabled>
        Connecting...
      </button>
    );
  }

  if (publicKey) {
    return (
      <div className="flex flex-col items-end space-y-1">
        <div className="flex items-center space-x-2">
          {network && (
            <span className={`text-xs px-2 py-1 rounded-md border font-medium ${
              isMismatch
                ? "bg-red-900/40 text-red-300 border-red-700"
                : network.toUpperCase().includes("MAINNET") || network.toUpperCase().includes("PUBLIC")
                  ? "bg-green-900/30 text-green-400 border-green-800"
                  : "bg-yellow-900/30 text-yellow-300 border-yellow-700"
            }`}>
              {isMismatch && <span aria-label="Network mismatch" title="Network mismatch">⚠ </span>}
              {network.toUpperCase()}
            </span>
          )}
          <a
            href={buildExplorerUrl('address', publicKey)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`View address ${publicKey.substring(0, 4)}...${publicKey.substring(publicKey.length - 4)} on Stellar explorer, opens in new tab`}
            className="text-white text-sm bg-gray-900 hover:bg-gray-800 px-3 py-1 rounded-md border border-gray-700 hover:border-gray-600 transition flex items-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
          >
            {publicKey.substring(0, 4)}...{publicKey.substring(publicKey.length - 4)}
            <ExternalLink size={12} aria-hidden="true" className="opacity-60" />
          </a>
          <button
            onClick={handleDisconnect}
            className="px-3 py-1 rounded-md bg-red-600/80 text-white text-sm hover:bg-red-700 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
          >
            Disconnect
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end space-y-2">
      <button
        onClick={connectWallet}
        className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
      >
        Connect Freighter Wallet
      </button>
      {error && (
        <div className="w-full max-w-xs mt-2">
          <ErrorInline 
            error={error} 
            category="wallet"
            variant="banner"
            onRetry={connectWallet}
            onClose={() => setError(null)}
          />
        </div>
      )}
    </div>
  );
};
