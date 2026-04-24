'use client';

import React from 'react';
import type { RedactionTool, RedactionLevel, EvidenceArtifact } from '@/types/evidence-artifact';

interface RedactionControlsProps {
  artifact: EvidenceArtifact;
  isEditing: boolean;
  selectedTool: RedactionTool;
  selectedRegions: string[];
  onToggleEdit: () => void;
  onToolChange: (tool: RedactionTool) => void;
  onRegionRemove: (regionIds: string[]) => void;
  onRedactionLevelChange: (level: RedactionLevel) => void;
  onAutoRedaction: () => void;
  onClearAllRedactions: () => void;
  className?: string;
}

export const RedactionControls: React.FC<RedactionControlsProps> = ({
  artifact,
  isEditing,
  selectedTool,
  selectedRegions,
  onToggleEdit,
  onToolChange,
  onRegionRemove,
  onRedactionLevelChange,
  onAutoRedaction,
  onClearAllRedactions,
  className = '',
}) => {
  const hasPermission = artifact.permissions.canModifyRedactions;
  const hasSelectedRegions = selectedRegions.length > 0;
  const hasRedactions = artifact.redactionState.regions.length > 0;

  if (!hasPermission) {
    return (
      <div className={`border-t border-gray-200 dark:border-gray-700 p-4 ${className}`}>
        <div className="text-sm text-gray-500 dark:text-gray-400">
          You don&apos;t have permission to modify redactions for this artifact.
        </div>
      </div>
    );
  }

  return (
    <div className={`border-t border-gray-200 dark:border-gray-700 p-4 space-y-4 ${className}`}>
      {/* Edit Mode Toggle */}
      <div className="flex items-center justify-between">
        <button
          onClick={onToggleEdit}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
            isEditing
              ? 'bg-red-500 hover:bg-red-600 text-white'
              : 'bg-blue-500 hover:bg-blue-600 text-white'
          }`}
        >
          {isEditing ? 'Stop Editing' : 'Edit Redactions'}
        </button>
        
        {/* Redaction Level Selector */}
        <div className="flex items-center space-x-2">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Redaction Level:
          </label>
          <select
            value={artifact.redactionState.level}
            onChange={(e) => onRedactionLevelChange(e.target.value as RedactionLevel)}
            className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          >
            <option value="none">None</option>
            <option value="partial">Partial</option>
            <option value="full">Full</option>
            <option value="custom">Custom</option>
          </select>
        </div>
      </div>

      {/* Editing Tools */}
      {isEditing && (
        <div className="space-y-3">
          {/* Tool Selection */}
          <div className="flex items-center space-x-4">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Redaction Tool:
            </label>
            <div className="flex space-x-2">
              {[
                { type: 'blackout' as const, label: 'Blackout', icon: '■' },
                { type: 'blur' as const, label: 'Blur', icon: '◯' },
                { type: 'pixelate' as const, label: 'Pixelate', icon: '▦' },
              ].map(({ type, label, icon }) => (
                <button
                  key={type}
                  onClick={() => onToolChange({ ...selectedTool, type })}
                  className={`px-3 py-2 text-sm rounded-md border transition-colors ${
                    selectedTool.type === type
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                      : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  <span className="mr-1">{icon}</span>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Reason Input */}
          <div className="flex items-center space-x-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Reason:
            </label>
            <input
              type="text"
              value={selectedTool.reason}
              onChange={(e) => onToolChange({ ...selectedTool, reason: e.target.value })}
              placeholder="Enter reason for redaction"
              className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400"
            />
          </div>

          {/* Auto Redaction Options */}
          <div className="flex items-center space-x-2">
            <button
              onClick={onAutoRedaction}
              className="px-3 py-2 text-sm bg-purple-500 hover:bg-purple-600 text-white rounded-md transition-colors"
            >
              🤖 Auto-Detect PII
            </button>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Automatically detect and redact personally identifiable information
            </span>
          </div>
        </div>
      )}

      {/* Selected Regions Actions */}
      {hasSelectedRegions && (
        <div className="flex items-center justify-between p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md">
          <span className="text-sm text-yellow-800 dark:text-yellow-200">
            {selectedRegions.length} region(s) selected
          </span>
          <div className="flex space-x-2">
            <button
              onClick={() => onRegionRemove(selectedRegions)}
              className="px-3 py-1 text-sm bg-red-500 hover:bg-red-600 text-white rounded transition-colors"
            >
              Remove Selected
            </button>
            <button
              onClick={() => onRegionRemove([])}
              className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Clear Selection
            </button>
          </div>
        </div>
      )}

      {/* Bulk Actions */}
      {hasRedactions && (
        <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md">
          <div className="text-sm text-gray-600 dark:text-gray-400">
            {artifact.redactionState.regions.length} redaction(s) applied
            {artifact.redactionState.lastModified && (
              <span className="ml-2">
                • Last modified: {artifact.redactionState.lastModified.toLocaleDateString()}
              </span>
            )}
          </div>
          <button
            onClick={onClearAllRedactions}
            className="px-3 py-1 text-sm bg-red-500 hover:bg-red-600 text-white rounded transition-colors"
          >
            Clear All
          </button>
        </div>
      )}

      {/* Statistics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div className="text-center">
          <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
            {artifact.redactionState.regions.length}
          </div>
          <div className="text-gray-600 dark:text-gray-400">Total Regions</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-green-600 dark:text-green-400">
            {artifact.redactionState.autoGeneratedRegions.length}
          </div>
          <div className="text-gray-600 dark:text-gray-400">Auto-Generated</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
            {artifact.redactionState.manuallyReviewedRegions.length}
          </div>
          <div className="text-gray-600 dark:text-gray-400">Reviewed</div>
        </div>
        <div className="text-center">
          <div className={`text-2xl font-bold ${
            artifact.metadata.piiDetected ? 'text-red-600 dark:text-red-400' : 'text-gray-400'
          }`}>
            {artifact.metadata.piiDetected ? '⚠️' : '✓'}
          </div>
          <div className="text-gray-600 dark:text-gray-400">PII Status</div>
        </div>
      </div>

      {/* Help Text */}
      {isEditing && (
        <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
          <p>• Click and drag on the artifact to create redaction regions</p>
          <p>• Click on existing regions to select them</p>
          <p>• Use the tool selector to change redaction style</p>
          <p>• Auto-detect PII to automatically identify sensitive information</p>
        </div>
      )}
    </div>
  );
};

// Redaction History Component
interface RedactionHistoryProps {
  artifact: EvidenceArtifact;
  className?: string;
}

export const RedactionHistory: React.FC<RedactionHistoryProps> = ({
  artifact,
  className = '',
}) => {
  const { regions } = artifact.redactionState;
  
  if (regions.length === 0) {
    return (
      <div className={`p-4 text-center text-gray-500 dark:text-gray-400 ${className}`}>
        No redaction history available
      </div>
    );
  }

  return (
    <div className={`border-t border-gray-200 dark:border-gray-700 p-4 ${className}`}>
      <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
        Redaction History
      </h4>
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {regions.map((region, index) => (
          <div
            key={region.id}
            className="flex items-center justify-between p-2 text-sm bg-gray-50 dark:bg-gray-800 rounded"
          >
            <div className="flex-1">
              <div className="font-medium text-gray-900 dark:text-gray-100">
                {region.reason || 'Unspecified reason'}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                by {region.createdBy} • {region.createdAt.toLocaleDateString()} {region.createdAt.toLocaleTimeString()}
              </div>
            </div>
            <div className="text-xs text-gray-400">
              #{regions.length - index}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
