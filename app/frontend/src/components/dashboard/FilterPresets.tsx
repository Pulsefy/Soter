'use client';

import React, { useState, useCallback } from 'react';
import { Bookmark, BookmarkCheck, Copy, Check, Trash2, RotateCcw, Plus, X } from 'lucide-react';
import type { AidPackageFilters, FilterScope } from '@/types/aid-package';
import { useFilterPresets } from '@/hooks/useFilterPresets';

// ── Tiny toast helper ────────────────────────────────────────────────────────

function useTransientLabel(duration = 1800) {
  const [label, setLabel] = useState<string | null>(null);

  const flash = useCallback(
    (msg: string) => {
      setLabel(msg);
      const t = setTimeout(() => setLabel(null), duration);
      return () => clearTimeout(t);
    },
    [duration],
  );

  return { label, flash };
}

// ── Props ────────────────────────────────────────────────────────────────────

interface FilterPresetsProps {
  /** Current active filter values — used when saving a preset. */
  filters: AidPackageFilters;
  /** Which page's presets to manage. */
  scope: FilterScope;
  /**
   * Called when the user clicks a preset chip or "Restore Defaults".
   * The parent should replace the URL params with these filters.
   */
  onApply: (filters: AidPackageFilters) => void;
}

// ── Component ────────────────────────────────────────────────────────────────

export function FilterPresets({ filters, scope, onApply }: FilterPresetsProps) {
  const { presets, savePreset, deletePreset } = useFilterPresets(scope);

  const [showForm, setShowForm] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);

  const { label: toastMsg, flash } = useTransientLabel();
  const { label: copyLabel, flash: flashCopy } = useTransientLabel(1500);

  // ── Actions ────────────────────────────────────────────────────────────────

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!presetName.trim()) {
      setNameError('Please enter a name for the preset.');
      return;
    }
    savePreset(presetName.trim(), filters);
    flash(`"${presetName.trim()}" saved`);
    setPresetName('');
    setNameError(null);
    setShowForm(false);
  }

  function handleDelete(id: string, name: string) {
    deletePreset(id);
    flash(`"${name}" deleted`);
  }

  function handleCopyLink() {
    if (typeof window !== 'undefined') {
      navigator.clipboard.writeText(window.location.href).then(() => {
        flashCopy('Copied!');
      });
    }
  }

  function handleRestoreDefaults() {
    onApply({ search: '', status: '', token: '' });
    flash('Filters cleared');
  }

  function handleApplyPreset(presetFilters: AidPackageFilters) {
    onApply(presetFilters);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const hasActiveFilters = !!(filters.search || filters.status || filters.token);

  return (
    <div className="space-y-3">
      {/* Action row */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Save preset button / toggle */}
        <button
          type="button"
          onClick={() => {
            setShowForm(v => !v);
            setNameError(null);
          }}
          aria-label={showForm ? 'Cancel saving preset' : 'Save current filters as preset'}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400 text-xs font-medium hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors"
        >
          {showForm ? (
            <>
              <X size={13} />
              Cancel
            </>
          ) : (
            <>
              <Bookmark size={13} />
              Save preset
            </>
          )}
        </button>

        {/* Copy shareable URL */}
        <button
          type="button"
          onClick={handleCopyLink}
          aria-label="Copy shareable link"
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-xs font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          {copyLabel ? (
            <>
              <Check size={13} className="text-green-500" />
              {copyLabel}
            </>
          ) : (
            <>
              <Copy size={13} />
              Copy link
            </>
          )}
        </button>

        {/* Restore defaults — only shown when filters are active */}
        {hasActiveFilters && (
          <button
            type="button"
            onClick={handleRestoreDefaults}
            aria-label="Restore default filters"
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 text-xs hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            <RotateCcw size={12} />
            Defaults
          </button>
        )}

        {/* Transient feedback toast */}
        {toastMsg && (
          <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400 font-medium animate-fade-in">
            <BookmarkCheck size={13} />
            {toastMsg}
          </span>
        )}
      </div>

      {/* Inline save form */}
      {showForm && (
        <form
          onSubmit={handleSave}
          className="flex items-center gap-2 p-3 rounded-lg border border-blue-100 dark:border-blue-900/60 bg-blue-50/60 dark:bg-blue-950/20"
        >
          <input
            type="text"
            value={presetName}
            onChange={e => {
              setPresetName(e.target.value);
              setNameError(null);
            }}
            placeholder="Name this preset…"
            maxLength={40}
            autoFocus
            className="flex-1 h-8 px-3 rounded-md border border-blue-200 dark:border-blue-800 bg-white dark:bg-gray-900 text-sm text-gray-700 dark:text-gray-300 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
          />
          <button
            type="submit"
            className="inline-flex items-center gap-1 h-8 px-3 rounded-md bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 transition-colors"
          >
            <Plus size={13} />
            Save
          </button>
          {nameError && <p className="text-xs text-red-500 ml-1">{nameError}</p>}
        </form>
      )}

      {/* Saved preset chips */}
      {presets.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">
            Saved:
          </span>
          {presets.map(preset => (
            <span
              key={preset.id}
              className="group inline-flex items-center gap-1 h-7 pl-3 pr-1.5 rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs text-gray-700 dark:text-gray-300 hover:border-blue-400 dark:hover:border-blue-600 hover:text-blue-700 dark:hover:text-blue-400 transition-colors cursor-pointer"
            >
              {/* Clicking the label applies the preset */}
              <button
                type="button"
                onClick={() => handleApplyPreset(preset.filters)}
                aria-label={`Apply preset: ${preset.name}`}
                className="focus:outline-none"
              >
                {preset.name}
              </button>

              {/* Delete button */}
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  handleDelete(preset.id, preset.name);
                }}
                aria-label={`Delete preset: ${preset.name}`}
                className="ml-0.5 p-0.5 rounded-full text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors focus:outline-none"
              >
                <Trash2 size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
