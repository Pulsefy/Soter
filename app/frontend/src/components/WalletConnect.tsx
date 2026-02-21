"use client";

import React, { useEffect, useState } from "react";
import { isConnected, setAllowed, getAddress } from "@stellar/freighter-api";
import { useWalletStore } from "../lib/walletStore";

export const WalletConnect: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { publicKey, setPublicKey, disconnect } = useWalletStore();
  const [freighterInstalled, setFreighterInstalled] = useState(true); // Assume installed until proven otherwise
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    async function checkFreighterAvailability() {
      // Check if Freighter API is available
      if (typeof window === "undefined" || !(window as any).FreighterApi) {
        setFreighterInstalled(false);
        console.warn("Freighter is not installed or available in the browser.");
        return;
      } else {
        setFreighterInstalled(true);
      }

      console.log("Checking Freighter connection...");
      try {
        const freighterStatus = await isConnected();
        console.log("Freighter connected status (raw from isConnected()):", freighterStatus);

        const isActuallyConnected = typeof freighterStatus === 'object' && freighterStatus !== null && 'isConnected' in freighterStatus
          ? freighterStatus.isConnected
          : freighterStatus;

        console.log("Freighter is actually connected:", isActuallyConnected);

        if (isActuallyConnected) {
          const pubKey = await getAddress();
          console.log("Raw pubKey object from getAddress():", pubKey);
          if (pubKey && pubKey.address) {
            setPublicKey(pubKey.address);
          } else {
            console.warn("getAddress() returned no address.", pubKey);
            setPublicKey(null);
          }
        }
      } catch (error) {
        console.error("Error checking Freighter connection:", error);
        setPublicKey(null);
      }
    }
    checkFreighterAvailability();
  }, [setPublicKey]);

  const connectWallet = async () => {
    // if (!freighterInstalled) {
    //   alert("Stellar Freighter wallet is not installed. Please install it to connect.");
    //   return;
    // }

    setLoading(true);
    setError(null);
    console.log("Attempting to connect wallet...");
    try {
      console.log("Calling setAllowed()...");
      let setAllowedResult;
      try {
        setAllowedResult = await setAllowed();
        console.log("setAllowed() result:", setAllowedResult);
      } catch (err) {
        console.error("Error during setAllowed():", err);
        // User likely rejected the connection request
        setError("Connection cancelled. Please try again and approve the request in Freighter.");
        throw err;
      }

      console.log("Freighter permissions set. Calling getAddress()...");
      let pubKey;
      try {
        pubKey = await getAddress();
        console.log("Raw pubKey object from getAddress() after connect:", pubKey);
      } catch (err) {
        console.error("Error during getAddress() after setAllowed():", err);
        setError("Couldn't read your wallet address. Make sure Freighter is unlocked and try again.");
        throw err;
      }

      if (pubKey && pubKey.address) {
        setPublicKey(pubKey.address);
      } else {
        console.warn("getAddress() returned no address after connect.", pubKey);
        setError("Access not granted. Please approve the Freighter request to connect your wallet.");
        setPublicKey(null);
      }
    } catch (err) {
      console.error("Final catch: Error connecting to Freighter:", err);
      // Only set generic error if specific error wasn't already set
      setError((prev) => prev || "Something went wrong. Please refresh and try connecting again.");
      setPublicKey(null);
    } finally {
      setLoading(false);
    }
  };

  // if (!freighterInstalled) {
  //   return (
  //     <button
  //       onClick={() => window.open("https://www.stellar.org/ecosystem/projects/freighter", "_blank")}
  //       className="px-4 py-2 rounded-md bg-yellow-600 text-white hover:bg-yellow-700"
  //     >
  //       Install Freighter
  //     </button>
  //   );
  // }

  if (!mounted) {
    return null; // Avoid hydration mismatch on initial render
  }

  if (loading) {
    return (
      <button className="px-4 py-2 rounded-md bg-gray-700 text-white" disabled>
        Connecting...
      </button>
    );
  }

  if (publicKey) {
    return (
      <div className="flex flex-col items-end space-y-1">
        <div className="flex items-center space-x-2">
          <span className="text-white text-sm bg-gray-900 px-3 py-1 rounded-md border border-gray-700">
            {publicKey.substring(0, 4)}...{publicKey.substring(publicKey.length - 4)}
          </span>
          <button
            onClick={disconnect}
            className="px-3 py-1 rounded-md bg-red-600/80 text-white text-sm hover:bg-red-700 transition"
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
        className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 transition"
      >
        Connect Freighter Wallet
      </button>
      {error && (
        <span className="text-red-400 text-xs max-w-xs text-right break-words">{error}</span>
      )}
    </div>
  );
};
