import React, { useState } from "react";
import { networkLabel, truncateId, networkBadgeColor } from "@/lib/network-metadata";

type Props = {
  environment: "preview" | "production";
  network: "testnet" | "mainnet";
  contractId: string;
};

export default function NetworkIndicator({
  environment,
  network,
  contractId,
}: Props) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(contractId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const label = networkLabel(network);

  return (
    <div className="fixed top-3 left-3 z-50 flex flex-col sm:flex-row gap-2 sm:items-center bg-black/80 text-white px-3 py-2 rounded-xl backdrop-blur-md shadow-lg text-xs sm:text-sm">
      
      {/* Environment */}
      <span
        className={`px-2 py-1 rounded-md font-medium ${
          environment === "production"
            ? "bg-green-600"
            : "bg-yellow-600"
        }`}
      >
        {environment.toUpperCase()}
      </span>

      {/* Network */}
      <span className={`px-2 py-1 rounded-md font-medium ${networkBadgeColor(network)}`}>
        {label}
      </span>

      {/* Contract */}
      <div className="flex items-center gap-2">
        <span className="font-mono bg-white/10 px-2 py-1 rounded-md" title={contractId}>
          {truncateId(contractId)}
        </span>

        <button
          onClick={handleCopy}
          className="px-2 py-1 rounded-md bg-white/10 hover:bg-white/20 transition"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}