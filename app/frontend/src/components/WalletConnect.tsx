"use client";

import React, { useEffect, useState } from "react";
import { isConnected, setAllowed, getAddress } from "@stellar/freighter-api";
import { useWalletStore } from "../lib/walletStore";

export const WalletConnect: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const { publicKey, setPublicKey } = useWalletStore();
  const [freighterInstalled, setFreighterInstalled] = useState(true); // Assume installed until proven otherwise

  useEffect(() => {
    async function checkFreighterAvailability() {
      // Check if Freighter API is available
      if (typeof window === "undefined" || !(window as any).FreighterApi) {
        setFreighterInstalled(false);
        console.error("Freighter is not installed or available in the browser.");
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
        alert("Wallet connection rejected or failed. Please try again.");
        throw err;
      }

      console.log("Freighter permissions set. Calling getAddress()...");
      let pubKey;
      try {
        pubKey = await getAddress();
        console.log("Raw pubKey object from getAddress() after connect:", pubKey);
      } catch (err) {
        console.error("Error during getAddress() after setAllowed():", err);
        alert("Failed to retrieve wallet address. Please ensure Freighter is unlocked and try again.");
        throw err;
      }

      if (pubKey && pubKey.address) {
        setPublicKey(pubKey.address);
      } else {
        console.warn("getAddress() returned no address after connect.", pubKey);
        alert("Failed to retrieve wallet address. Result was empty.");
        setPublicKey(null);
      }
    } catch (error) {
      console.error("Final catch: Error connecting to Freighter:", error);
      setPublicKey(null);
    } finally {
      setLoading(false);
    }
  };

  const disconnectWallet = () => {
    setPublicKey(null);
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

  if (loading) {
    return (
      <button className="px-4 py-2 rounded-md bg-gray-700 text-white" disabled>
        Connecting...
      </button>
    );
  }

  if (publicKey) {
    return (
      <div className="flex items-center space-x-2">
        <span className="text-white text-sm">
          {publicKey.substring(0, 4)}...{publicKey.substring(publicKey.length - 4)}
        </span>
        <button
          onClick={disconnectWallet}
          className="px-3 py-1 rounded-md bg-red-600 text-white text-sm hover:bg-red-700"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={connectWallet}
      className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700"
    >
      Connect Wallet
    </button>
  );
};
