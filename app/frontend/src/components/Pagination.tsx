'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  /** Current 1-based page number. */
  page: number;
  /** Total number of pages. */
  totalPages: number;
  /** Number of items per page. */
  pageSize: number;
  /** Total item count across all pages. */
  totalItems: number;
  /** Called with the requested page number when the user navigates. */
  onPageChange: (page: number) => void;
}

/**
 * Pagination – keyboard-navigable prev/next controls with a single polite
 * ARIA live region that announces page changes to screen readers.
 *
 * Announcement format: "Page X of Y, showing items A–B"
 *
 * The live region fires only when the current page actually changes, so
 * initial render and same-page re-renders are silent.  Mount this component
 * once per paginated list to avoid duplicate announcements.
 */
export function Pagination({
  page,
  totalPages,
  pageSize,
  totalItems,
  onPageChange,
}: PaginationProps) {
  const prevPageRef = useRef<number | null>(null);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    // Skip the very first render – no page change has occurred yet
    if (prevPageRef.current === null) {
      prevPageRef.current = page;
      return;
    }
    // Skip if the page didn't actually change
    if (prevPageRef.current === page) return;

    prevPageRef.current = page;

    const firstItem = (page - 1) * pageSize + 1;
    const lastItem = Math.min(page * pageSize, totalItems);
    setAnnouncement(
      `Page ${page} of ${totalPages}, showing items ${firstItem}\u2013${lastItem}`,
    );
  }, [page, totalPages, pageSize, totalItems]);

  return (
    <div className="flex items-center justify-between pt-2">
      {/* Visually hidden polite live region – announces page changes to screen readers */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>

      <span className="text-xs text-gray-500 dark:text-gray-400" aria-hidden="true">
        Page {page} of {totalPages}
      </span>

      <div className="flex gap-1">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
          className="h-8 w-8 flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft size={14} aria-hidden={true} />
        </button>
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="Next page"
          className="h-8 w-8 flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronRight size={14} aria-hidden={true} />
        </button>
      </div>
    </div>
  );
}
