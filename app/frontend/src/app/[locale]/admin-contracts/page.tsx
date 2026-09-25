import React from 'react';
import { AdminContractRegistry } from '@/components/AdminContractRegistry';

export default function AdminContractsPage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Contract Registry</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Active contract IDs, network labels, and deployment metadata. Admin access required.
        </p>
      </div>
      <AdminContractRegistry />
    </div>
  );
}
