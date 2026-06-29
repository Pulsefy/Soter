'use client';

import React, { useState, useEffect } from 'react';
import { Trash2, RefreshCw, Key, Shield } from 'lucide-react';
import { useToast } from './ToastProvider';
import { useBiometricGate } from '@/hooks/useBiometricGate';
import { createProtectedAdminService } from '@/services/adminService';
import { ApiKey } from '@/services/apiKeyService';
import { BiometricConfirmationModal } from './BiometricConfirmationModal';

/**
 * Example component demonstrating biometric-protected admin actions.
 * 
 * This component shows how to integrate the biometric gate with
 * high-risk admin operations (revoke and rotate API keys).
 */
export const AdminApiKeyManager: React.FC = () => {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedKey, setSelectedKey] = useState<ApiKey | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalAction, setModalAction] = useState<'revoke' | 'rotate' | null>(null);
  
  const { toast } = useToast();
  const biometricGate = useBiometricGate();
  const adminService = createProtectedAdminService();

  // Load API keys on mount
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
      await loadKeys(); // Refresh list
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
      } else if (modalAction === 'rotate') {
        await adminService.rotateKey(selectedKey.id, biometricGate);
        toast('Key rotated', 'API key has been rotated successfully', 'success');
      }
      
      await loadKeys(); // Refresh list
      setModalOpen(false);
      setSelectedKey(null);
      setModalAction(null);
    } catch (error) {
      if (error instanceof Error && error.message !== 'Action cancelled by user') {
        toast('Action failed', `Failed to ${modalAction} API key`, 'error');
      }
      setModalOpen(false);
    }
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
        title: 'Rotate API Key',
        description: `Rotate the API key "${selectedKey.name}"? This will invalidate the current key and generate a new one. Existing integrations using this key will need to be updated.`,
        confirmText: 'Rotate Key',
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
            API Key Management
          </h2>
          <p className="text-sm text-gray-500">
            Manage API keys for system access. High-risk actions require biometric confirmation.
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

      {/* Biometric status banner */}
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
                  High-risk actions are protected with biometric authentication.
                  Your device supports secure identity verification.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* API Keys Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead>
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Key Name
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Created
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Last Used
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
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
              keys.map((key) => (
                <tr key={key.id}>
                  <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                    {key.name}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                    {new Date(key.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                    {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : 'Never'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        key.isActive
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {key.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleRotate(key)}
                        disabled={biometricGate.isLoading || !key.isActive}
                        className="inline-flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium text-yellow-700 bg-yellow-50 hover:bg-yellow-100 border border-yellow-200 disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Rotate key (requires confirmation)"
                      >
                        <RefreshCw className="h-3 w-3" />
                        Rotate
                      </button>
                      <button
                        onClick={() => handleRevoke(key)}
                        disabled={biometricGate.isLoading || !key.isActive}
                        className="inline-flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Revoke key (requires biometric confirmation)"
                      >
                        <Trash2 className="h-3 w-3" />
                        Revoke
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Fallback Confirmation Modal */}
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

      {/* Help text */}
      <div className="mt-6 text-sm text-gray-500 border-t border-gray-200 pt-4">
        <div className="flex items-start gap-2">
          <Shield className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium text-gray-700">Security Information:</p>
            <ul className="list-disc pl-5 mt-1 space-y-1">
              <li>
                <span className="font-medium">Revoke:</span> High-risk action requiring biometric confirmation when available
              </li>
              <li>
                <span className="font-medium">Rotate:</span> Medium-risk action requiring standard confirmation
              </li>
              <li>
                <span className="font-medium">Create:</span> Low-risk action with optional confirmation
              </li>
              <li>When biometrics are unavailable, standard confirmation dialogs are shown</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};