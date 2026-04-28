'use client';

import React, { useState, useRef, useCallback } from 'react';
import type {
  EvidenceArtifact,
  ArtifactViewerState,
  RedactionRegion,
  RedactionTool,
  ViewMode,
  PIIDetectionResult,
} from '@/types/evidence-artifact';

interface EvidenceArtifactViewerProps {
  artifact: EvidenceArtifact;
  onRedactionChange?: (regions: RedactionRegion[]) => void;
  onArtifactUpdate?: (artifact: EvidenceArtifact) => void;
  className?: string;
}

export const EvidenceArtifactViewer: React.FC<EvidenceArtifactViewerProps> = ({
  artifact,
  onRedactionChange,
  onArtifactUpdate,
  className = '',
}) => {
  const [viewerState, setViewerState] = useState<ArtifactViewerState>({
    selectedArtifact: artifact,
    viewMode: artifact.permissions.canViewOriginal ? 'original' : 'redacted',
    zoomLevel: 1,
    panPosition: { x: 0, y: 0 },
    showRedactionOverlay: true,
    selectedRegions: [],
    isEditingRedactions: false,
  });

  const [selectedTool, setSelectedTool] = useState<RedactionTool>({
    type: 'blackout',
    reason: 'Manual redaction',
  });

  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [currentRegion, setCurrentRegion] = useState<Partial<RedactionRegion> | null>(null);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  // Handle view mode changes
  const handleViewModeChange = useCallback((mode: ViewMode) => {
    if (mode === 'original' && !artifact.permissions.canViewOriginal) return;
    if (mode === 'redacted' && !artifact.permissions.canViewRedacted) return;
    
    setViewerState(prev => ({ ...prev, viewMode: mode }));
  }, [artifact.permissions]);

  // Handle zoom controls
  const handleZoomIn = useCallback(() => {
    setViewerState(prev => ({ ...prev, zoomLevel: Math.min(prev.zoomLevel * 1.2, 5) }));
  }, []);

  const handleZoomOut = useCallback(() => {
    setViewerState(prev => ({ ...prev, zoomLevel: Math.max(prev.zoomLevel / 1.2, 0.1) }));
  }, []);

  const handleZoomReset = useCallback(() => {
    setViewerState(prev => ({ ...prev, zoomLevel: 1, panPosition: { x: 0, y: 0 } }));
  }, []);

  // Handle redaction region selection
  const handleRegionClick = useCallback((regionId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    
    if (!viewerState.isEditingRedactions) {
      setViewerState(prev => ({
        ...prev,
        selectedRegions: prev.selectedRegions.includes(regionId)
          ? prev.selectedRegions.filter(id => id !== regionId)
          : [...prev.selectedRegions, regionId],
      }));
    }
  }, [viewerState.isEditingRedactions]);

  // Handle redaction region removal
  const handleRemoveRegion = useCallback((regionId: string) => {
    if (!artifact.permissions.canModifyRedactions) return;
    
    const updatedRegions = artifact.redactionState.regions.filter(r => r.id !== regionId);
    const updatedArtifact = {
      ...artifact,
      redactionState: {
        ...artifact.redactionState,
        regions: updatedRegions,
        lastModified: new Date(),
        modifiedBy: 'current-user', // This would come from auth context
      },
    };
    
    onArtifactUpdate?.(updatedArtifact);
    onRedactionChange?.(updatedRegions);
  }, [artifact, onArtifactUpdate, onRedactionChange]);

  // Handle mouse events for drawing new redaction regions
  const handleMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!viewerState.isEditingRedactions || !artifact.permissions.canModifyRedactions) return;
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;

    setIsDrawing(true);
    setDrawStart({ x, y });
    setCurrentRegion({ x, y, width: 0, height: 0 });
  }, [viewerState.isEditingRedactions, artifact.permissions]);

  const handleMouseMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!isDrawing || !drawStart || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const currentX = ((event.clientX - rect.left) / rect.width) * 100;
    const currentY = ((event.clientY - rect.top) / rect.height) * 100;

    setCurrentRegion({
      x: Math.min(drawStart.x, currentX),
      y: Math.min(drawStart.y, currentY),
      width: Math.abs(currentX - drawStart.x),
      height: Math.abs(currentY - drawStart.y),
    });
  }, [isDrawing, drawStart]);

  const handleMouseUp = useCallback(() => {
    if (!isDrawing || !currentRegion || !artifact.permissions.canModifyRedactions) return;

    const newRegion: RedactionRegion = {
      id: `region-${Date.now()}`,
      x: currentRegion.x || 0,
      y: currentRegion.y || 0,
      width: currentRegion.width || 0,
      height: currentRegion.height || 0,
      reason: selectedTool.reason,
      createdAt: new Date(),
      createdBy: 'current-user', // This would come from auth context
    };

    const updatedRegions = [...artifact.redactionState.regions, newRegion];
    const updatedArtifact = {
      ...artifact,
      redactionState: {
        ...artifact.redactionState,
        regions: updatedRegions,
        lastModified: new Date(),
        modifiedBy: 'current-user',
      },
    };

    onArtifactUpdate?.(updatedArtifact);
    onRedactionChange?.(updatedRegions);

    setIsDrawing(false);
    setDrawStart(null);
    setCurrentRegion(null);
  }, [isDrawing, currentRegion, artifact, selectedTool, onArtifactUpdate, onRedactionChange]);

  // Render redaction overlay
  const renderRedactionOverlay = useCallback(() => {
    if (!viewerState.showRedactionOverlay) return null;
    if (viewerState.viewMode === 'original') return null;

    const regions = viewerState.viewMode === 'redacted' 
      ? artifact.redactionState.regions 
      : [];

    return (
      <div className="absolute inset-0 pointer-events-none">
        {regions.map(region => (
          <div
            key={region.id}
            className={`absolute border-2 ${
              viewerState.selectedRegions.includes(region.id)
                ? 'border-yellow-400'
                : 'border-red-500'
            } ${
              viewerState.isEditingRedactions ? 'pointer-events-auto cursor-pointer' : ''
            }`}
            style={{
              left: `${region.x}%`,
              top: `${region.y}%`,
              width: `${region.width}%`,
              height: `${region.height}%`,
              backgroundColor: selectedTool.type === 'blackout' ? 'rgba(0, 0, 0, 0.9)' : 
                           selectedTool.type === 'blur' ? 'rgba(255, 255, 255, 0.8)' : 
                           'rgba(0, 0, 0, 0.7)',
              backdropFilter: selectedTool.type === 'blur' ? 'blur(8px)' : 
                             selectedTool.type === 'pixelate' ? 'pixelate(8)' : 'none',
            }}
            onClick={(e) => handleRegionClick(region.id, e)}
            title={region.reason}
          />
        ))}
        
        {/* Current drawing region */}
        {isDrawing && currentRegion && (
          <div
            className="absolute border-2 border-blue-500 bg-blue-200 bg-opacity-30"
            style={{
              left: `${currentRegion.x}%`,
              top: `${currentRegion.y}%`,
              width: `${currentRegion.width}%`,
              height: `${currentRegion.height}%`,
            }}
          />
        )}
      </div>
    );
  }, [viewerState, artifact.redactionState.regions, selectedTool.type, isDrawing, currentRegion, handleRegionClick]);

  // Render artifact content based on type
  const renderArtifactContent = useCallback(() => {
    const { metadata, content } = artifact;
    
    switch (metadata.type) {
      case 'image':
        return (
          <div className="relative overflow-hidden">
            <img
              ref={imageRef}
              src={content}
              alt={metadata.filename}
              className="w-full h-auto"
              style={{
                transform: `scale(${viewerState.zoomLevel}) translate(${viewerState.panPosition.x}px, ${viewerState.panPosition.y}px)`,
                transition: 'transform 0.2s ease',
              }}
            />
            {renderRedactionOverlay()}
          </div>
        );
      
      case 'document':
        return (
          <div className="relative">
            <iframe
              src={content}
              className="w-full h-96 border-0"
              title={metadata.filename}
            />
            {renderRedactionOverlay()}
          </div>
        );
      
      case 'text':
        return (
          <div className="relative p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <pre className="whitespace-pre-wrap text-sm">
              {viewerState.viewMode === 'redacted' && artifact.redactionState.regions.length > 0
                ? '[Content redacted for privacy protection]'
                : content}
            </pre>
            {renderRedactionOverlay()}
          </div>
        );
      
      default:
        return (
          <div className="p-4 text-center text-gray-500">
            Unsupported artifact type: {metadata.type}
          </div>
        );
    }
  }, [artifact, viewerState, renderRedactionOverlay]);

  return (
    <div className={`bg-white dark:bg-gray-900 rounded-lg shadow-lg ${className}`}>
      {/* Header with controls */}
      <div className="border-b border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <h3 className="text-lg font-semibold">{artifact.metadata.filename}</h3>
            <span className="text-sm text-gray-500">
              {artifact.metadata.type} • {(artifact.metadata.size / 1024 / 1024).toFixed(2)} MB
            </span>
          </div>
          
          {/* View mode controls */}
          <div className="flex items-center space-x-2">
            {artifact.permissions.canViewOriginal && (
              <button
                onClick={() => handleViewModeChange('original')}
                className={`px-3 py-1 text-sm rounded ${
                  viewerState.viewMode === 'original'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                }`}
              >
                Original
              </button>
            )}
            {artifact.permissions.canViewRedacted && (
              <button
                onClick={() => handleViewModeChange('redacted')}
                className={`px-3 py-1 text-sm rounded ${
                  viewerState.viewMode === 'redacted'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                }`}
              >
                Redacted
              </button>
            )}
            {artifact.permissions.canViewOriginal && artifact.permissions.canViewRedacted && (
              <button
                onClick={() => handleViewModeChange('comparison')}
                className={`px-3 py-1 text-sm rounded ${
                  viewerState.viewMode === 'comparison'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                }`}
              >
                Compare
              </button>
            )}
          </div>
        </div>
        
        {/* Zoom controls */}
        <div className="flex items-center space-x-2 mt-3">
          <button
            onClick={handleZoomOut}
            className="p-1 text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
            </svg>
          </button>
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {Math.round(viewerState.zoomLevel * 100)}%
          </span>
          <button
            onClick={handleZoomIn}
            className="p-1 text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
          <button
            onClick={handleZoomReset}
            className="p-1 text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Artifact content */}
      <div
        ref={containerRef}
        className="relative p-4 min-h-96"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {renderArtifactContent()}
      </div>

      {/* Redaction controls */}
      {artifact.permissions.canModifyRedactions && (
        <div className="border-t border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setViewerState(prev => ({ ...prev, isEditingRedactions: !prev.isEditingRedactions }))}
              className={`px-4 py-2 text-sm rounded ${
                viewerState.isEditingRedactions
                  ? 'bg-red-500 text-white'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
              }`}
            >
              {viewerState.isEditingRedactions ? 'Stop Editing' : 'Edit Redactions'}
            </button>
            
            {viewerState.isEditingRedactions && (
              <div className="flex items-center space-x-2">
                <select
                  value={selectedTool.type}
                  onChange={(e) => setSelectedTool(prev => ({ ...prev, type: e.target.value as RedactionTool['type'] }))}
                  className="px-3 py-1 text-sm border rounded"
                >
                  <option value="blackout">Blackout</option>
                  <option value="blur">Blur</option>
                  <option value="pixelate">Pixelate</option>
                </select>
                
                <input
                  type="text"
                  placeholder="Reason for redaction"
                  value={selectedTool.reason}
                  onChange={(e) => setSelectedTool(prev => ({ ...prev, reason: e.target.value }))}
                  className="px-3 py-1 text-sm border rounded"
                />
              </div>
            )}
          </div>
          
          {/* Selected regions actions */}
          {viewerState.selectedRegions.length > 0 && (
            <div className="mt-3 flex items-center space-x-2">
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {viewerState.selectedRegions.length} region(s) selected
              </span>
              <button
                onClick={() => {
                  viewerState.selectedRegions.forEach(id => handleRemoveRegion(id));
                  setViewerState(prev => ({ ...prev, selectedRegions: [] }));
                }}
                className="px-3 py-1 text-sm bg-red-500 text-white rounded"
              >
                Remove Selected
              </button>
            </div>
          )}
        </div>
      )}

      {/* Metadata panel */}
      <div className="border-t border-gray-200 dark:border-gray-700 p-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="font-medium">Uploaded:</span>
            <span className="ml-2 text-gray-600 dark:text-gray-400">
              {artifact.metadata.uploadedAt.toLocaleDateString()}
            </span>
          </div>
          <div>
            <span className="font-medium">Redaction Level:</span>
            <span className="ml-2 text-gray-600 dark:text-gray-400">
              {artifact.redactionState.level}
            </span>
          </div>
          <div>
            <span className="font-medium">PII Detected:</span>
            <span className={`ml-2 ${artifact.metadata.piiDetected ? 'text-red-500' : 'text-green-500'}`}>
              {artifact.metadata.piiDetected ? 'Yes' : 'No'}
            </span>
          </div>
          <div>
            <span className="font-medium">Regions:</span>
            <span className="ml-2 text-gray-600 dark:text-gray-400">
              {artifact.redactionState.regions.length}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
