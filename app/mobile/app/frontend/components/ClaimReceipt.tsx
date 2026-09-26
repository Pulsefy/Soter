import React, { useState } from 'react';
import { getExplorerUrl } from '../utils/explorer';

interface ClaimReceiptProps {
  txHash: string;
  contractId: string;
  amount: string;
  recipient: string;
}

export default function ClaimReceipt({ txHash, contractId, amount, recipient }: ClaimReceiptProps) {
  const [copiedTx, setCopiedTx] = useState(false);
  const [copiedContract, setCopiedContract] = useState(false);

  const copyToClipboard = async (text: string, setCopied: (v: boolean) => void) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="max-w-md mx-auto bg-white shadow-md rounded-lg p-6 border border-gray-200">
      <h2 className="text-xl font-bold text-gray-900 mb-4">Claim Receipt</h2>
      <div className="space-y-4">
        <div>
          <span className="block text-sm font-medium text-gray-500">Amount</span>
          <span className="text-lg font-semibold text-gray-800">{amount}</span>
        </div>
        <div>
          <span className="block text-sm font-medium text-gray-500">Recipient</span>
          <span className="text-sm text-gray-800 break-all">{recipient}</span>
        </div>
        <div className="border-t pt-3">
          <span className="block text-sm font-medium text-gray-500">Transaction Hash</span>
          <div className="flex items-center justify-between mt-1 gap-2">
            <a
              href={getExplorerUrl('tx', txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 hover:underline break-all"
            >
              {txHash}
            </a>
            <button
              onClick={() => copyToClipboard(txHash, setCopiedTx)}
              className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded transition"
            >
              {copiedTx ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
        <div className="border-t pt-3">
          <span className="block text-sm font-medium text-gray-500">Contract Link</span>
          <div className="flex items-center justify-between mt-1 gap-2">
            <a
              href={getExplorerUrl('address', contractId)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 hover:underline break-all"
            >
              {contractId}
            </a>
            <button
              onClick={() => copyToClipboard(contractId, setCopiedContract)}
              className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded transition"
            >
              {copiedContract ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
