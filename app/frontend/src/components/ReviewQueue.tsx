'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Check, X, ChevronDown, ChevronUp, Eye, Keyboard } from 'lucide-react';
import { useToast } from './ToastProvider';

interface QueueItem {
  id: string;
  submitter: string;
  type: string;
  submittedAt: string;
  details: string;
}

export const ReviewQueue: React.FC = () => {
  const [items, setItems] = useState<QueueItem[]>([
    { id: 'q-1', submitter: 'Jane Doe', type: 'Identity Verification', submittedAt: '2026-08-28', details: 'Government ID matches provided credentials.' },
    { id: 'q-2', submitter: 'Acme Corp', type: 'Business Compliance', submittedAt: '2026-08-27', details: 'Articles of incorporation verified against registry.' },
    { id: 'q-3', submitter: 'John Smith', type: 'Address Proof', submittedAt: '2026-08-26', details: 'Utility bill statement within 30-day window.' },
  ]);
  
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string>('');
  const itemRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const { toast } = useToast();

  const activeItem = items[currentIndex];

  const announceToScreenReader = (message: string) => {
    setAnnouncement(message);
    setTimeout(() => setAnnouncement(''), 4000);
  };

  const handleApprove = useCallback((item: QueueItem) => {
    setItems((prev) => {
      const filtered = prev.filter((i) => i.id !== item.id);
      const nextIdx = Math.min(currentIndex, filtered.length - 1);
      setCurrentIndex(Math.max(0, nextIdx));
      return filtered;
    });
    announceToScreenReader(`Approved item for ${item.submitter}. Moved to next item.`);
    toast('Approved', `Item ${item.id} approved successfully`, 'success');
  }, [currentIndex, toast]);

  const handleReject = useCallback((item: QueueItem) => {
    setItems((prev) => {
      const filtered = prev.filter((i) => i.id !== item.id);
      const nextIdx = Math.min(currentIndex, filtered.length - 1);
      setCurrentIndex(Math.max(0, nextIdx));
      return filtered;
    });
    announceToScreenReader(`Rejected item for ${item.submitter}. Moved to next item.`);
    toast('Rejected', `Item ${item.id} rejected`, 'info');
  }, [currentIndex, toast]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  // Global keyboard shortcuts handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Do not intercept if user is typing in inputs or modals
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) {
        return;
      }

      if (items.length === 0) return;

      switch (e.key.toLowerCase()) {
        case 'j':
        case 'arrowdown':
          e.preventDefault();
          setCurrentIndex((prev) => Math.min(prev + 1, items.length - 1));
          break;
        case 'k':
        case 'arrowup':
          e.preventDefault();
          setCurrentIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'a':
          e.preventDefault();
          if (activeItem) handleApprove(activeItem);
          break;
        case 'r':
          e.preventDefault();
          if (activeItem) handleReject(activeItem);
          break;
        case 'e':
        case ' ':
          e.preventDefault();
          if (activeItem) toggleExpand(activeItem.id);
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [items, activeItem, handleApprove, handleReject, toggleExpand]);

  // Focus management when currentIndex changes
  useEffect(() => {
    if (activeItem && itemRefs.current[activeItem.id]) {
      itemRefs.current[activeItem.id]?.focus();
    }
  }, [currentIndex, activeItem]);

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 max-w-4xl mx-auto space-y-6">
      {/* Hidden ARIA live region for screen reader announcements */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      <div className="flex items-center justify-between border-b border-gray-200 pb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Keyboard className="h-5 w-5 text-gray-500" />
            Verification Review Queue
          </h2>
          <p className="text-sm text-gray-500">
            Process submissions rapidly using keyboard shortcuts.
          </p>
        </div>
        <div className="text-xs bg-gray-100 text-gray-600 px-3 py-1.5 rounded-md border border-gray-200 flex items-center gap-3">
          <span><strong className="text-gray-900">J/K</strong> Navigate</span>
          <span><strong className="text-gray-900">A</strong> Approve</span>
          <span><strong className="text-gray-900">R</strong> Reject</span>
          <span><strong className="text-gray-900">E/Space</strong> Details</span>
        </div>
      </div>

      <div className="space-y-3 focus:outline-none" tabIndex={0}>
        {items.length === 0 ? (
          <div className="text-center py-12 text-sm text-gray-500 bg-gray-50 rounded-lg border border-dashed border-gray-300">
            Review queue is clear. Great job!
          </div>
        ) : (
          items.map((item, index) => {
            const isSelected = index === currentIndex;
            const isExpanded = expandedId === item.id;

            return (
              <div
                key={item.id}
                ref={(el) => { itemRefs.current[item.id] = el; }}
                tabIndex={isSelected ? 0 : -1}
                className={`border rounded-lg p-4 transition-all outline-none ${
                  isSelected
                    ? 'border-indigo-500 ring-2 ring-indigo-100 bg-indigo-50/20'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
                onClick={() => setCurrentIndex(index)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono text-gray-400">#{index + 1}</span>
                    <div>
                      <h3 className="text-sm font-medium text-gray-900">{item.submitter}</h3>
                      <p className="text-xs text-gray-500">{item.type} • Submitted {item.submittedAt}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleExpand(item.id); }}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                      aria-expanded={isExpanded}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      {isExpanded ? 'Hide Details' : 'Details'}
                      {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleApprove(item); }}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-green-600 rounded-md hover:bg-green-700"
                      title="Approve item (Shortcut: A)"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Approve
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleReject(item); }}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-red-600 rounded-md hover:bg-red-700"
                      title="Reject item (Shortcut: R)"
                    >
                      <X className="h-3.5 w-3.5" />
                      Reject
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-4 pt-3 border-t border-gray-200 text-sm text-gray-700 bg-gray-50 p-3 rounded">
                    <p className="font-medium text-xs text-gray-500 uppercase tracking-wider mb-1">Verification Payload Details</p>
                    <p>{item.details}</p>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};