import React, { useState } from "react";

type Props = {
  environment: "preview" | "production";
  network: "testnet" | "mainnet";
  contractId: string;
};

function truncateId(id: string) {
  if (!id) return "";
  if (id.length <= 12) return id;
  return `${id.slice(0, 6)}...${id.slice(-4)}`;
}

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
      <span className="px-2 py-1 rounded-md bg-blue-600 font-medium">
        {network.toUpperCase()}
      </span>

      {/* Contract */}
      <div className="flex items-center gap-2">
        <span className="font-mono bg-white/10 px-2 py-1 rounded-md">
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