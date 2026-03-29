import React, { Suspense } from 'react';
import { DashboardContent } from '@/components/dashboard/DashboardContent';
import { MapSection } from '@/components/dashboard/MapSection';
//import React, { Suspense } from 'react';
//import { DashboardContent } from '@/components/dashboard/DashboardContent';

{/*function StatCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="p-6 rounded-lg border border-gray-200 dark:border-gray-800">
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-3xl font-bold">—</p>
      <p className="text-gray-600 dark:text-gray-400 text-sm mt-1">{description}</p>
    </div>
  );
}

{/*function PackageListSkeleton() {
  return (
    <div className="p-6 bg-white dark:bg-gray-900 rounded-xl shadow-lg border border-gray-100 dark:border-gray-800 space-y-5 animate-pulse">
      <div className="h-5 bg-gray-100 dark:bg-gray-800 rounded w-32" />
      <div className="h-10 bg-gray-100 dark:bg-gray-800 rounded" />
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-12 bg-gray-100 dark:bg-gray-800 rounded" />
        ))}
      </div>
    </div>
  );
}
*/}

export default function AidDashboard() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-gray-50 dark:to-gray-950">
      <main className="container mx-auto px-4 py-16 flex-grow">
        <div className="max-w-5xl mx-auto space-y-8">
          {/* Header */}
          <div className="text-center space-y-4">
            <h1 className="text-5xl md:text-6xl font-bold tracking-tight">Aid Dashboard</h1>
            <p className="text-xl md:text-2xl text-gray-600 dark:text-gray-400">
              Onchain Aid, Fully Transparent
            </p>
            <p className="text-lg text-gray-700 dark:text-gray-300 max-w-2xl mx-auto">
              This dashboard displays humanitarian aid packages funded via Soter on the Stellar /
              Soroban blockchain — every distribution anchored onchain and auditable by anyone.
            </p>
          </div>

          {/* Stat Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <StatCard title="Packages Funded" description="Live data coming soon" />
            <StatCard title="Total Distributed" description="Pulled from Soroban contracts" />
            <StatCard title="Recipients Reached" description="Verified on-chain claims" />
          </div>

          {/* Live Map */}
          <MapSection />

          {/* Search / Filter + Package list — client, needs Suspense for useSearchParams */}
          <Suspense fallback={<PackageListSkeleton />}>
            <DashboardContent />
          </Suspense>

          {/* Coming-soon note */}
          <p className="text-center text-gray-600 dark:text-gray-400 text-sm">
            Full API wiring, claim tracking, and impact reports coming in a future wave.
          </p>

          {/* CTA buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
              Get Notified
            </button>
            <button className="px-6 py-3 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
              Learn More
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}


function StatCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="p-6 rounded-lg border border-gray-200 dark:border-gray-800">
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-3xl font-bold">—</p>
      <p className="text-gray-600 dark:text-gray-400 text-sm mt-1">{description}</p>
    </div>
  );
}

function PackageListSkeleton() {
  return (
    <div className="p-6 bg-white dark:bg-gray-900 rounded-xl shadow-lg border border-gray-100 dark:border-gray-800 space-y-5 animate-pulse">
      <div className="h-5 bg-gray-100 dark:bg-gray-800 rounded w-32" />
      <div className="h-10 bg-gray-100 dark:bg-gray-800 rounded" />
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-12 bg-gray-100 dark:bg-gray-800 rounded" />
        ))}
      </div>
    </div>
  );
}


