'use client';

import React, { useState } from 'react';
import { Download, Check, AlertCircle, Loader2 } from 'lucide-react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { ChevronDown } from 'lucide-react';
import type { AidPackageFilters } from '@/types/aid-package';

type ExportFormat = 'CSV' | 'PDF' | 'JSON';

interface ExportControlsProps {
  context: string;
  filters?: Record<string, any>;
  label?: string;
}

export function ExportControls({ context, filters, label }: ExportControlsProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('CSV');

  async function handleExport() {
    if (isExporting) return;

    setIsExporting(true);
    setExportStatus('idle');

    // Simulate API call
    try {
      console.log(`Exporting ${context} in ${selectedFormat} with filters:`, filters);
      
      // Simulate delay
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Randomly fail 10% of the time for demo purposes
      if (Math.random() < 0.1) {
        throw new Error('Export failed');
      }

      setExportStatus('success');
      setTimeout(() => setExportStatus('idle'), 3000);
    } catch (error) {
      console.error(error);
      setExportStatus('error');
      setTimeout(() => setExportStatus('idle'), 5000);
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center rounded-xl border border-gray-200/50 dark:border-gray-700/50 bg-white/80 dark:bg-gray-950/80 backdrop-blur-md overflow-hidden shadow-sm hover:shadow-md transition-all duration-300">
        {/* Format Selector */}
        <SelectPrimitive.Root 
          value={selectedFormat} 
          onValueChange={(v) => setSelectedFormat(v as ExportFormat)}
          disabled={isExporting}
        >
          <SelectPrimitive.Trigger 
            className="flex items-center gap-2 h-10 px-4 border-r border-gray-200/50 dark:border-gray-700/50 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors focus:outline-none disabled:opacity-50"
            aria-label="Select export format"
          >
            <SelectPrimitive.Value />
            <SelectPrimitive.Icon>
              <ChevronDown size={14} className="opacity-50" />
            </SelectPrimitive.Icon>
          </SelectPrimitive.Trigger>

          <SelectPrimitive.Portal>
            <SelectPrimitive.Content
              position="popper"
              sideOffset={8}
              className="z-50 min-w-[100px] overflow-hidden rounded-xl border border-gray-200/50 dark:border-gray-700/50 bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl shadow-2xl animate-in fade-in zoom-in-95 duration-200"
            >
              <SelectPrimitive.Viewport className="p-1.5">
                {(['CSV', 'PDF', 'JSON'] as ExportFormat[]).map((format) => (
                  <SelectPrimitive.Item
                    key={format}
                    value={format}
                    className="flex items-center px-3 py-2 rounded-lg text-xs font-medium text-gray-700 dark:text-gray-300 cursor-pointer select-none outline-none data-[highlighted]:bg-blue-500 data-[highlighted]:text-white transition-colors"
                  >
                    <SelectPrimitive.ItemText>{format}</SelectPrimitive.ItemText>
                  </SelectPrimitive.Item>
                ))}
              </SelectPrimitive.Viewport>
            </SelectPrimitive.Content>
          </SelectPrimitive.Portal>
        </SelectPrimitive.Root>

        {/* Export Button */}
        <button
          onClick={handleExport}
          disabled={isExporting}
          className={`flex items-center gap-2 h-10 px-5 text-xs font-bold transition-all duration-500 ${
            exportStatus === 'success'
              ? 'bg-emerald-500 text-white'
              : exportStatus === 'error'
              ? 'bg-rose-500 text-white'
              : 'text-blue-600 dark:text-blue-400 hover:bg-blue-600 hover:text-white dark:hover:bg-blue-500/20'
          } disabled:opacity-70 disabled:cursor-not-allowed`}
        >
          {isExporting ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              <span className="animate-pulse">Preparing...</span>
            </>
          ) : exportStatus === 'success' ? (
            <>
              <Check size={16} strokeWidth={3} />
              <span>Downloaded</span>
            </>
          ) : exportStatus === 'error' ? (
            <>
              <AlertCircle size={16} />
              <span>Retry</span>
            </>
          ) : (
            <>
              <Download size={16} className={label ? 'mr-1' : ''} />
              <span>{label || 'Export'}</span>
            </>
          )}
        </button>
      </div>

      {/* Success/Error Toast-like message (inline) */}
      <div className="flex flex-col">
        {exportStatus === 'success' && (
          <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-tighter animate-in fade-in slide-in-from-left-2 duration-300">
            System: {selectedFormat} Report Ready
          </span>
        )}
        {exportStatus === 'error' && (
          <span className="text-[10px] text-rose-600 dark:text-rose-400 font-bold uppercase tracking-tighter animate-in fade-in slide-in-from-left-2 duration-300">
            Error: Export Timeout
          </span>
        )}
      </div>
    </div>
  );
}
