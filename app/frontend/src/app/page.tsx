import { AidPackageList } from '@/components/AidPackageList';

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-gray-50 dark:to-gray-950">
      <main className="container mx-auto px-4 py-16 flex-grow">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          <h1 className="text-5xl md:text-6xl font-bold tracking-tight">
            Soter
          </h1>
          <p className="text-xl md:text-2xl text-gray-600 dark:text-gray-400">
            Transparent Aid, Directly Delivered
          </p>
          <p className="text-lg text-gray-700 dark:text-gray-300 max-w-2xl mx-auto">
            An open-source, privacy-first platform on the Stellar blockchain
            that empowers donors and NGOs to distribute humanitarian aid
            directly to individuals in crisis.
          </p>

          {/* Demo of Mock API */}
          <div className="max-w-2xl mx-auto mt-8 p-6 bg-white dark:bg-gray-900 rounded-xl shadow-lg border border-gray-100 dark:border-gray-800">
            <AidPackageList />
          </div>

          <div className="flex flex-col sm:flex-row gap-4 justify-center mt-8">
            <button className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
              Get Started
            </button>
            <button className="px-6 py-3 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
              Learn More
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-16">
            <div className="p-6 rounded-lg border border-gray-200 dark:border-gray-800">
              <h3 className="text-lg font-semibold mb-2">Direct Aid Claims</h3>
              <p className="text-gray-600 dark:text-gray-400">
                Wallet-based, passwordless claiming—no accounts required.
              </p>
            </div>
            <div className="p-6 rounded-lg border border-gray-200 dark:border-gray-800">
              <h3 className="text-lg font-semibold mb-2">
                AI Need Verification
              </h3>
              <p className="text-gray-600 dark:text-gray-400">
                Client-side analysis for privacy-preserving eligibility.
              </p>
            </div>
            <div className="p-6 rounded-lg border border-gray-200 dark:border-gray-800">
              <h3 className="text-lg font-semibold mb-2">
                Immutable Transparency
              </h3>
              <p className="text-gray-600 dark:text-gray-400">
                On-chain anchoring of distributions and impact reports.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
