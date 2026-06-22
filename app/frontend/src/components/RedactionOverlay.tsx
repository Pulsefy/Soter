'use client';

import React from 'react';
import type { RedactionRegion, RedactionTool } from '@/types/evidence-artifact';

interface RedactionOverlayProps {
  regions: RedactionRegion[];
  selectedRegions: string[];
  viewMode: 'original' | 'redacted' | 'comparison';
  tool: RedactionTool;
  isEditing: boolean;
  onRegionClick?: (regionId: string, event: React.MouseEvent) => void;
  onRegionHover?: (regionId: string | null) => void;
  className?: string;
}

export const RedactionOverlay: React.FC<RedactionOverlayProps> = ({
  regions,
  selectedRegions,
  viewMode,
  tool,
  isEditing,
  onRegionClick,
  onRegionHover,
  className = '',
}) => {
  // Don't show overlay in original mode unless editing
  if (viewMode === 'original' && !isEditing) {
    return null;
  }

  // Get redaction style based on tool type
  const getRedactionStyle = (regionTool: RedactionTool['type']) => {
    switch (regionTool) {
      case 'blackout':
        return {
          backgroundColor: 'rgba(0, 0, 0, 0.95)',
          backdropFilter: 'none',
        };
      case 'blur':
        return {
          backgroundColor: 'rgba(255, 255, 255, 0.1)',
          backdropFilter: 'blur(12px)',
        };
      case 'pixelate':
        return {
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          backdropFilter: 'pixelate(10px)',
        };
      default:
        return {
          backgroundColor: 'rgba(0, 0, 0, 0.9)',
          backdropFilter: 'none',
        };
    }
  };

  // Comparison mode styling
  const getComparisonStyle = () => {
    if (viewMode !== 'comparison') return {};
    
    return {
      backgroundColor: 'rgba(255, 0, 0, 0.1)',
      border: '2px dashed rgba(255, 0, 0, 0.5)',
    };
  };

  return (
    <div className={`absolute inset-0 pointer-events-none ${className}`}>
      {regions.map(region => {
        const isSelected = selectedRegions.includes(region.id);
        const redactionStyle = getRedactionStyle(tool.type);
        const comparisonStyle = getComparisonStyle();
        
        return (
          <div
            key={region.id}
            className={`absolute border-2 transition-all duration-200 ${
              isSelected
                ? 'border-yellow-400 shadow-lg shadow-yellow-400/50'
                : viewMode === 'comparison'
                ? 'border-red-500'
                : 'border-transparent'
            } ${
              isEditing ? 'pointer-events-auto cursor-pointer' : ''
            }`}
            style={{
              left: `${region.x}%`,
              top: `${region.y}%`,
              width: `${region.width}%`,
              height: `${region.height}%`,
              ...redactionStyle,
              ...comparisonStyle,
            }}
            onClick={(e) => onRegionClick?.(region.id, e)}
            onMouseEnter={() => onRegionHover?.(region.id)}
            onMouseLeave={() => onRegionHover?.(null)}
            title={`${region.reason || 'Redacted content'}${region.createdAt ? ` (Added: ${region.createdAt.toLocaleDateString()})` : ''}`}
          >
            {/* Selection indicator */}
            {isSelected && (
              <div className="absolute -top-2 -right-2 w-4 h-4 bg-yellow-400 rounded-full border-2 border-white" />
            )}
            
            {/* Region info tooltip when hovering */}
            {isSelected && (
              <div className="absolute bottom-full left-0 mb-2 p-2 bg-gray-900 text-white text-xs rounded shadow-lg whitespace-nowrap z-50">
                <div className="font-medium">{region.reason || 'Redacted region'}</div>
                {region.createdAt && (
                  <div className="text-gray-300">
                    {region.createdAt.toLocaleDateString()}
                  </div>
                )}
                <div className="absolute top-full left-2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// Redaction region drawing component for creating new regions
interface RedactionRegionDrawingProps {
  isDrawing: boolean;
  currentRegion: { x: number; y: number; width: number; height: number } | null;
  tool: RedactionTool;
  className?: string;
}

export const RedactionRegionDrawing: React.FC<RedactionRegionDrawingProps> = ({
  isDrawing,
  currentRegion,
  tool,
  className = '',
}) => {
  if (!isDrawing || !currentRegion) {
    return null;
  }

  const getDrawingStyle = () => {
    switch (tool.type) {
      case 'blackout':
        return 'bg-black bg-opacity-50';
      case 'blur':
        return 'bg-white bg-opacity-30 backdrop-blur-sm';
      case 'pixelate':
        return 'bg-black bg-opacity-40';
      default:
        return 'bg-black bg-opacity-50';
    }
  };

  return (
    <div
      className={`absolute border-2 border-blue-500 ${getDrawingStyle()} ${className}`}
      style={{
        left: `${currentRegion.x}%`,
        top: `${currentRegion.y}%`,
        width: `${currentRegion.width}%`,
        height: `${currentRegion.height}%`,
        pointerEvents: 'none',
      }}
    />
  );
};

// PII detection overlay component
interface PIIDetectionOverlayProps {
  piiRegions: Array<{
    type: string;
    confidence: number;
    region: RedactionRegion;
  }>;
  showPII: boolean;
  onRegionClick?: (region: RedactionRegion) => void;
  className?: string;
}

export const PIIDetectionOverlay: React.FC<PIIDetectionOverlayProps> = ({
  piiRegions,
  showPII,
  onRegionClick,
  className = '',
}) => {
  if (!showPII || piiRegions.length === 0) {
    return null;
  }

  const getPIIColor = (type: string) => {
    switch (type.toLowerCase()) {
      case 'email':
        return 'border-orange-500 bg-orange-500/10';
      case 'phone':
        return 'border-purple-500 bg-purple-500/10';
      case 'national id':
      case 'ssn':
        return 'border-red-500 bg-red-500/10';
      case 'address':
        return 'border-blue-500 bg-blue-500/10';
      default:
        return 'border-yellow-500 bg-yellow-500/10';
    }
  };

  return (
    <div className={`absolute inset-0 pointer-events-none ${className}`}>
      {piiRegions.map(({ type, confidence, region }, index) => (
        <div
          key={`${region.id}-${index}`}
          className={`absolute border-2 cursor-pointer pointer-events-auto ${getPIIColor(type)}`}
          style={{
            left: `${region.x}%`,
            top: `${region.y}%`,
            width: `${region.width}%`,
            height: `${region.height}%`,
          }}
          onClick={() => onRegionClick?.(region)}
          title={`${type} detected (${Math.round(confidence * 100)}% confidence)`}
        >
          {/* PII type indicator */}
          <div className="absolute -top-1 -left-1 px-1 text-xs bg-gray-900 text-white rounded">
            {type}
          </div>
          
          {/* Confidence indicator */}
          <div className="absolute -bottom-1 -right-1 px-1 text-xs bg-gray-900 text-white rounded">
            {Math.round(confidence * 100)}%
          </div>
        </div>
      ))}
    </div>
  );
};
