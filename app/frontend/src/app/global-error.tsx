'use client';

import { useEffect } from 'react';

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    // Log the error natively to the developer console
    console.error('Critical Global Application Error:', error);
  }, [error]);

  return (
    <html lang="en">
      <body className="antialiased flex flex-col items-center justify-center min-h-screen bg-slate-950 text-slate-50 p-6">
        <div className="max-w-md w-full border border-slate-800 bg-slate-900/50 p-6 rounded-xl shadow-2xl text-center backdrop-blur-sm">
          {/* Soter Icon/Brand Placeholder */}
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/10 text-rose-500">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className="w-6 h-6"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m0-10.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.75c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.57-.598-3.75h-.152c-3.196 0-6.1-1.249-8.25-3.286zm0 13.036h.008v.008H12v-.008z"
              />
            </svg>
          </div>

          <h2 className="text-xl font-bold text-white mb-2">
            Soter is temporarily unavailable
          </h2>
          
          <p className="text-sm text-slate-400 mb-6 leading-relaxed">
            The application shell encountered a critical fault before the page could finish loading. 
            Retry the request or refresh your environment.
          </p>

          {process.env.NODE_ENV !== 'production' && (
            <div className="mb-6 p-3 rounded bg-slate-950 border border-slate-800 text-left overflow-auto max-h-40">
              <p className="text-xs font-mono text-rose-400 break-all whitespace-pre-wrap">
                {error?.message || 'Unknown runtime compilation failure'}
              </p>
              {error?.digest && (
                <p className="text-[10px] font-mono text-slate-500 mt-1">
                  Digest: {error.digest}
                </p>
              )}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <button
              onClick={() => reset()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-sm font-medium transition-colors cursor-pointer"
            >
              Retry Request
            </button>
            <button
              onClick={() => { window.location.href = '/dashboard'; }}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md text-sm font-medium transition-colors cursor-pointer"
            >
              Return Home
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
