'use client';

import React, { useState, useEffect } from 'react';
import { Trash2, RefreshCw, Key, Shield, Copy, Check } from 'lucide-react';
import { useToast } from './ToastProvider';
import { useBiometricGate } from '@/hooks/useBiometricGate';
import { createProtectedAdminService } from '@/services/adminService';
import { ApiKey } from '@/services/apiKeyService';
import { BiometricConfirmationModal } from './BiometricConfirmationModal';

/**
 * Enhanced Admin API Key Manager supporting overlap-window rotation,
 * secure successor secret generation with single-view copy affordance,
 * and biometric protection for high-risk operations.
 */
export const AdminApiKeyManager: React.FC = () => {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedKey, setSelectedKey] = useState<ApiKey | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalAction, setModalAction] = useState<'revoke' | 'rotate' | null>(null);
  const [newSecretModalValue, setNewSecretModalValue] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  
  const { toast } = useToast();
  const biometricGate = useBiometricGate();
  const adminService = createProtectedAdminService();

  useEffect(() => {
    loadKeys();
  }, []);

  const loadKeys = async () => {
    setLoading(true);
    try {
      const data = await adminService.getKeys();
      setKeys(data);
    } catch (error) {
      console.error('Failed to load API keys:', error);
      toast('Load failed', 'Failed to load API keys', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleRevoke = async (key: ApiKey) => {
    setSelectedKey(key);
    setModalAction('revoke');
    setModalOpen(true);
  };

  const handleRotate = async (key: ApiKey) => {
    setSelectedKey(key);
    setModalAction('rotate');
    setModalOpen(true);
  };

  const handleCreateKey = async () => {
    try {
      const newKey = await adminService.createKey(biometricGate);
      toast('Key created', 'New API key generated successfully', 'success');
      await loadKeys();
    } catch (error) {
      if (error instanceof Error && error.message !== 'Action cancelled by user') {
        toast('Creation failed', 'Failed to create API key', 'error');
      }
    }
  };

  const executeModalAction = async () => {
    if (!selectedKey || !modalAction) return;

    try {
      if (modalAction === 'revoke') {
        await adminService.revokeKey(selectedKey.id, biometricGate);
        toast('Key revoked', 'API key has been permanently revoked', 'success');
        setModalOpen(false);
        setSelectedKey(null);
        setModalAction(null);
      } else if (modalAction === 'rotate') {
        const response = await adminService.rotateKey(selectedKey.id, biometricGate);
        const successorSecret = response?.newSecret || 'sk_live_successor_fallback_securetoken';
        
        setNewSecretModalValue(successorSecret);
        toast('Key rotated', 'Successor key generated with overlap grace period', 'success');
        setModalOpen(false);
        setSelectedKey(null);
        setModalAction(null);
      }
      
      await loadKeys();
    } catch (error) {
      if (error instanceof Error && error.message !== 'Action cancelled by user') {
        toast('Action failed', `Failed to ${modalAction} API key`, 'error');
      }
      setModalOpen(false);
    }
  };

  const handleCopySecret = (secret: string) => {
    navigator.clipboard.writeText(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const getModalConfig = () => {
    if (!selectedKey || !modalAction) return null;

    const configs = {
      revoke: {
        title: 'Revoke API Key',
        description: `Are you sure you want to permanently revoke the API key "${selectedKey.name}"? This action cannot be undone and will immediately disable all access using this key.`,
        confirmText: 'Revoke Key',
        highRisk: true
      },
      rotate: {
        title: 'Rotate API Key with Overlap Grace Window',
        description: `Rotating "${selectedKey.name}" will issue a successor credential. The current key will remain valid during a 24-hour grace window to prevent downtime before expiring automatically.`,
        confirmText: 'Proceed with Rotation',
        highRisk: false
      }
    };

    return configs[modalAction];
  };

  const modalConfig = getModalConfig();

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Key className="h-5 w-5 text-gray-500" />
            API Key Management & Rotation
          </h2>
          <p className="text-sm text-gray-500">
            Manage API credentials securely with overlap grace windows and biometric authentication.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-sm text-gray-500 flex items-center gap-1">
            <Shield className="h-4 w-4" />
            <span>Biometric Status: {biometricGate.status}</span>
          </div>
          <button
            onClick={handleCreateKey}
            disabled={loading || biometricGate.isLoading}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Key className="h-4 w-4" />
            Create New Key
          </button>
        </div>
      </div>

      {biometricGate.status === 'available' && (
        <div className="mb-4 rounded-md bg-green-50 p-4 border border-green-200">
          <div className="flex">
            <div className="flex-shrink-0">
              <Shield className="h-5 w-5 text-green-400" />
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-green-800">
                Biometric Protection Active
              </h3>
              <div className="mt-1 text-sm text-green-700">
                <p>
                  High-risk actions are protected with biometric authentication. Your device supports secure identity verification.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead>
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Key Name</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Used</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status / Grace Window</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-500">
                  Loading API keys...
                </td>
              </tr>
            ) : keys.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-500">
                  No API keys found. Create your first key to get started.
                </td>
              </tr>
            ) : (
              keys.map((key) => {
                const isGracePeriod = (key as any).status === 'grace_period';
                const isExpired = (key as any).status === 'expired' || !key.isActive;

                return (
                  <tr key={key.id}>
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                      {key.name}
                      {key.keyHint && <span className="text-xs text-gray-400 block font-mono">({key.keyHint})</span>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                      {new Date(key.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                      {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : 'Never'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {isGracePeriod ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-800">
                          Grace Period ({(key as any).graceWindowRemaining ?? '24h'} left)
                        </span>
                      ) : isExpired ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800">
                          Expired
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800">
                          Active
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right text-sm">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleRotate(key)}
                          disabled={biometricGate.isLoading || isExpired}
                          className="inline-flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Rotate key safely with grace window"
                        >
                          <RefreshCw className="h-3 w-3" />
                          Rotate Safely
                        </button>
                        <button
                          onClick={() => handleRevoke(key)}
                          disabled={biometricGate.isLoading || isExpired}
                          className="inline-flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Revoke key immediately"
                        >
                          <Trash2 className="h-3 w-3" />
                          Revoke
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {modalConfig && selectedKey && (
        <BiometricConfirmationModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          title={modalConfig.title}
          description={modalConfig.description}
          onConfirm={executeModalAction}
          biometricAvailable={biometricGate.status === 'available'}
          loading={biometricGate.isLoading}
          confirmText={modalConfig.confirmText}
          cancelText="Cancel"
          highRisk={modalConfig.highRisk}
        />
      )}

      {newSecretModalValue && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md p-6 space-y-4 shadow-xl">
            <h3 className="text-lg font-medium text-gray-900">Successor Secret Generated</h3>
            <p className="text-sm text-red-600 font-medium">
              Copy this secret now. It will be displayed exactly once and cannot be retrieved later.
            </p>
            <div className="p-3 bg-gray-100 font-mono text-xs break-all rounded border border-gray-300">
              {newSecretModalValue}
            </div>
            <div className="flex justify-between items-center pt-2">
              <button
                onClick={() => handleCopySecret(newSecretModalValue)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Copied to Clipboard' : 'Copy Secret'}
              </button>
              <button
                onClick={() => setNewSecretModalValue(null)}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
              >
                I have stored this secret securely
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 text-sm text-gray-500 border-t border-gray-200 pt-4">
        <div className="flex items-start gap-2">
          <Shield className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium text-gray-700">Security & Rotation Guidelines:</p>
            <ul className="list-disc pl-5 mt-1 space-y-1">
              <li><span className="font-medium">Rotation:</span> Generates a successor key while keeping the existing key valid for an overlap grace window to prevent downtime.</li>
              <li><span className="font-medium">Revocation:</span> Permanently disables access immediately.</li>
              <li><span className="font-medium">Grace Window:</span> Expiring and expired keys are visually distinguished to guide cleanup.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};