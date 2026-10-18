import React from 'react';
import { AdminApiKeyManager } from '@/components/AdminApiKeyManager';
import { Shield, Fingerprint, AlertTriangle } from 'lucide-react';

export default function AdminBiometricDemoPage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Biometric Authentication Gate Demo
        </h1>
        <p className="text-lg text-gray-600">
          MVP implementation of biometric protection for admin/high-risk actions
        </p>
      </div>

      {/* Overview cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="rounded-full bg-blue-100 p-2">
              <Fingerprint className="h-6 w-6 text-blue-600" />
            </div>
            <h3 className="text-lg font-semibold text-blue-900">
              Biometric Detection
            </h3>
          </div>
          <p className="text-blue-800 text-sm">
            Automatically detects if biometric authentication is available on the device.
            Uses mock implementation that can be replaced with real biometric APIs.
          </p>
        </div>

        <div className="bg-green-50 border border-green-200 rounded-lg p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="rounded-full bg-green-100 p-2">
              <Shield className="h-6 w-6 text-green-600" />
            </div>
            <h3 className="text-lg font-semibold text-green-900">
              Smart Protection
            </h3>
          </div>
          <p className="text-green-800 text-sm">
            When biometrics are available, high-risk actions require biometric confirmation.
            When unavailable, falls back to standard confirmation dialogs.
          </p>
        </div>

        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="rounded-full bg-yellow-100 p-2">
              <AlertTriangle className="h-6 w-6 text-yellow-600" />
            </div>
            <h3 className="text-lg font-semibold text-yellow-900">
              High-Risk Actions
            </h3>
          </div>
          <p className="text-yellow-800 text-sm">
            Protects dangerous operations like deleting records, revoking credentials,
            and approving sensitive requests. Mock implementation ready for production.
          </p>
        </div>
      </div>

      {/* Demo section */}
      <div className="mb-8">
        <div className="bg-white rounded-lg border border-gray-300 p-6 mb-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">
            Live Demo: API Key Management
          </h2>
          <p className="text-gray-600 mb-4">
            Try the biometric-protected admin actions below. The system will:
          </p>
          <ul className="list-disc pl-5 text-gray-600 space-y-2 mb-6">
            <li>Check if biometric authentication is available on your device</li>
            <li>For high-risk actions (Revoke), require biometric confirmation when available</li>
            <li>For medium-risk actions (Rotate), show standard confirmation</li>
            <li>Fall back to confirmation dialogs when biometrics are unavailable</li>
            <li>Show appropriate loading states and error handling</li>
          </ul>

          <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-yellow-600" />
              <span className="text-sm font-medium text-gray-700">
                Mock Configuration
              </span>
            </div>
            <p className="text-sm text-gray-600">
              This is a mock implementation. To test different scenarios, you can set environment variables:
            </p>
            <div className="mt-2 text-xs font-mono bg-gray-100 p-2 rounded border border-gray-300">
              <div>NEXT_PUBLIC_MOCK_BIOMETRIC_AVAILABLE=true/false</div>
              <div>NEXT_PUBLIC_MOCK_BIOMETRIC_OUTCOME=success/failed/cancelled/error</div>
            </div>
          </div>
        </div>

        {/* The actual demo component */}
        <AdminApiKeyManager />
      </div>

      {/* Implementation details */}
      <div className="bg-gray-50 rounded-lg border border-gray-300 p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">
          Implementation Details
        </h2>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h3 className="text-lg font-medium text-gray-800 mb-3">
              Components Created
            </h3>
            <ul className="space-y-3">
              <li className="flex items-start gap-2">
                <div className="rounded-full bg-blue-100 p-1 mt-0.5">
                  <div className="h-2 w-2 rounded-full bg-blue-600"></div>
                </div>
                <div>
                  <span className="font-medium">biometricService.ts</span>
                  <p className="text-sm text-gray-600">Mock service with production-ready interface</p>
                </div>
              </li>
              <li className="flex items-start gap-2">
                <div className="rounded-full bg-green-100 p-1 mt-0.5">
                  <div className="h-2 w-2 rounded-full bg-green-600"></div>
                </div>
                <div>
                  <span className="font-medium">useBiometricGate hook</span>
                  <p className="text-sm text-gray-600">Reusable hook for biometric confirmation</p>
                </div>
              </li>
              <li className="flex items-start gap-2">
                <div className="rounded-full bg-purple-100 p-1 mt-0.5">
                  <div className="h-2 w-2 rounded-full bg-purple-600"></div>
                </div>
                <div>
                  <span className="font-medium">BiometricConfirmationModal</span>
                  <p className="text-sm text-gray-600">Reusable fallback confirmation dialog</p>
                </div>
              </li>
              <li className="flex items-start gap-2">
                <div className="rounded-full bg-yellow-100 p-1 mt-0.5">
                  <div className="h-2 w-2 rounded-full bg-yellow-600"></div>
                </div>
                <div>
                  <span className="font-medium">adminService.ts</span>
                  <p className="text-sm text-gray-600">Biometric-wrapped admin operations</p>
                </div>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-lg font-medium text-gray-800 mb-3">
              Key Features
            </h3>
            <ul className="space-y-2 text-gray-600">
              <li className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-gray-400"></div>
                <span>Production-structured but mock-only implementation</span>
              </li>
              <li className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-gray-400"></div>
                <span>Easy integration with real biometric APIs later</span>
              </li>
              <li className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-gray-400"></div>
                <span>Safe fallback when biometrics unavailable</span>
              </li>
              <li className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-gray-400"></div>
                <span>Loading states and error handling</span>
              </li>
              <li className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-gray-400"></div>
                <span>Follows existing Soter architecture patterns</span>
              </li>
              <li className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-gray-400"></div>
                <span>TypeScript support throughout</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-gray-300">
          <h3 className="text-lg font-medium text-gray-800 mb-3">
            Integration Example
          </h3>
          <div className="bg-gray-900 text-gray-100 p-4 rounded-lg font-mono text-sm overflow-x-auto">
            <pre>{`const { confirmBeforeAction } = useBiometricGate();

const handleDelete = async () => {
  await confirmBeforeAction(async () => {
    await deleteRecord();
  }, {
    reason: 'Delete sensitive record',
    fallbackMessage: 'Biometric auth unavailable. Continue?'
  });
};`}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}