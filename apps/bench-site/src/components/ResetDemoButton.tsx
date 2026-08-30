// ResetDemoButton.tsx — Restores bench sites and extension to known state in one click
// PLAN.md §24.2 Demo engineering rules

import React, { useState } from 'react';

interface ResetDemoButtonProps {
  onReset: () => Promise<void>;
}

export function ResetDemoButton({ onReset }: ResetDemoButtonProps) {
  const [isResetting, setIsResetting] = useState(false);
  const [lastReset, setLastReset] = useState<Date | null>(null);

  const handleReset = async () => {
    setIsResetting(true);
    try {
      await onReset();
      setLastReset(new Date());
    } catch (error) {
      console.error('Reset failed:', error);
      alert('Reset failed. Check console for details.');
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="reset-demo-container p-4 bg-gray-50 border-t border-gray-200">
      <div className="flex items-center gap-4 flex-wrap">
        <button
          onClick={handleReset}
          disabled={isResetting}
          className="px-4 py-2 text-sm font-medium text-white bg-gray-800 rounded-lg hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          {isResetting ? (
            <>
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Resetting…
            </>
          ) : (
            '🔄 Reset Demo'
          )}
        </button>

        {lastReset && (
          <span className="text-sm text-gray-600 font-mono">
            Last reset: {lastReset.toLocaleTimeString()}
          </span>
        )}

        <span className="text-xs text-gray-500 ml-auto">
          Clears cart, orders, form data & restores initial state
        </span>
      </div>
    </div>
  );
}