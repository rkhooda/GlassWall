// Confirm.tsx - Risk classification and confirmation UI
// Per PLAN.md §14.2 rung 10 and §11.4 high_risk_actions

import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

export type RiskLevel = 'low' | 'medium' | 'high';

export interface ActionRisk {
  level: RiskLevel;
  category: 'SUBMIT_LIKE' | 'NAVIGATE_EXTERNAL' | 'PAYMENT' | 'DELETE' | 'OTHER';
  reason: string;
}

export interface ConfirmationContext {
  actionType: string;
  targetLabel: string;
  targetRole: string;
  destination?: string; // For navigations
  risk: ActionRisk;
  vaultRef?: string; // e.g., "⟦EMAIL#1⟧"
  onApprove: () => void;
  onDeny: () => void;
}

const RISK_COLORS: Record<RiskLevel, { bg: string; border: string; text: string }> = {
  low: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-800' },
  medium: { bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-800' },
  high: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-800' }
};

const RISK_ICONS: Record<RiskLevel, string> = {
  low: '✓',
  medium: '⚠',
  high: '🛑'
};

const CATEGORY_LABELS: Record<ActionRisk['category'], string> = {
  SUBMIT_LIKE: 'Form Submit',
  NAVIGATE_EXTERNAL: 'External Navigation',
  PAYMENT: 'Payment',
  DELETE: 'Delete Action',
  OTHER: 'Other'
};

/**
 * Classifies an action's risk level per PLAN.md §11.4
 * Risk is computed by US (the extension) and carried in available_actions — never inferred by the model
 */
export function classifyActionRisk(
  actionType: string,
  targetRole: string,
  targetLabel: string,
  destination?: string,
  isExternalOrigin: boolean = false,
  vaultRef?: string
): ActionRisk {
  const type = actionType.toUpperCase();
  
  // NAVIGATE_EXTERNAL - highest risk for external origins
  if (type === 'NAVIGATE' && isExternalOrigin) {
    return {
      level: 'high',
      category: 'NAVIGATE_EXTERNAL',
      reason: `Navigation to external origin: ${destination || 'unknown'}`
    };
  }

  // PAYMENT - high risk for payment-related elements
  if (type === 'CLICK' || type === 'TYPE') {
    const label = targetLabel.toLowerCase();
    const role = targetRole.toLowerCase();
    
    // Check for payment indicators
    if (label.includes('pay') || label.includes('checkout') || label.includes('purchase') ||
        label.includes('credit') || label.includes('card') || label.includes('billing') ||
        vaultRef?.includes('CARD') || vaultRef?.includes('PAYMENT')) {
      return {
        level: 'high',
        category: 'PAYMENT',
        reason: 'Action involves payment or financial data'
      };
    }

    // Check for delete indicators
    if (label.includes('delete') || label.includes('remove') || label.includes('cancel') ||
        label.includes('destroy') || role === 'button' && (label.includes('trash') || label.includes('bin'))) {
      return {
        level: 'high',
        category: 'DELETE',
        reason: 'Action may delete data'
      };
    }

    // SUBMIT_LIKE - form submissions
    if (type === 'CLICK' && (role === 'button' || role === 'link')) {
      if (label.includes('submit') || label.includes('send') || label.includes('confirm') ||
          label.includes('place order') || label.includes('complete') || label.includes('finish')) {
        return {
          level: 'high',
          category: 'SUBMIT_LIKE',
          reason: 'Action submits a form or completes a transaction'
        };
      }
    }
  }

  // Medium risk for form interactions with sensitive data
  if (type === 'TYPE' && vaultRef) {
    return {
      level: 'medium',
      category: 'OTHER',
      reason: `Filling sensitive field (${vaultRef})`
    };
  }

  // Low risk for everything else
  return {
    level: 'low',
    category: 'OTHER',
    reason: 'Standard interaction'
  };
}

interface ConfirmProps {
  context: ConfirmationContext | null;
}

export function Confirm({ context }: ConfirmProps) {
  if (!context) return null;

  const { actionType, targetLabel, targetRole, destination, risk, vaultRef, onApprove, onDeny } = context;
  const colors = RISK_COLORS[risk.level];
  const icon = RISK_ICONS[risk.level];
  const categoryLabel = CATEGORY_LABELS[risk.category];

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        onApprove();
      } else if (e.key === 'Escape') {
        onDeny();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onApprove, onDeny]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className={`w-full max-w-md ${colors.bg} ${colors.border} border rounded-xl shadow-xl p-6`}>
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className={`text-3xl`}>{icon}</div>
          <div>
            <h2 id="confirm-title" className="text-lg font-semibold text-gray-900">Confirm Action</h2>
            <span className={`text-xs font-medium px-2 py-0.5 rounded ${colors.bg} ${colors.text} ${colors.border} border`}>
              {risk.level.toUpperCase()} RISK
            </span>
          </div>
        </div>

        {/* Risk category */}
        <div className="mb-4 p-3 bg-white/50 rounded-lg border">
          <div className="flex items-center gap-2 text-sm text-gray-600 mb-1">
            <span className="font-medium text-gray-900">Category:</span>
            <span>{categoryLabel}</span>
          </div>
          <div className="text-sm text-gray-600">
            <span className="font-medium text-gray-900">Reason:</span>
            <span className="ml-1">{risk.reason}</span>
          </div>
        </div>

        {/* Action details */}
        <div className="mb-4 space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-900 w-24">Action:</span>
            <span className="font-mono text-gray-700">{actionType}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-900 w-24">Target:</span>
            <span className="text-gray-700">{targetLabel}</span>
            <span className="text-gray-400 text-xs">({targetRole})</span>
          </div>
          {destination && (
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-900 w-24">Destination:</span>
              <span className="font-mono text-xs text-gray-700 truncate flex-1">{destination}</span>
            </div>
          )}
          {vaultRef && (
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-900 w-24">Value:</span>
              <span className="font-mono text-gray-700">{vaultRef}</span>
              <span className="text-xs text-amber-600">(from vault)</span>
            </div>
          )}
        </div>

        {/* Warning for high risk */}
        {risk.level === 'high' && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
            <strong>⚠ High-risk action:</strong> This action may submit data, navigate away, process a payment, or delete information. 
            Please review carefully before approving.
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-3 pt-2">
          <button
            onClick={onDeny}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500 transition-colors"
            autoFocus
          >
            Deny (Esc)
          </button>
          <button
            onClick={onApprove}
            className={`flex-1 px-4 py-2.5 text-sm font-medium text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors ${
              risk.level === 'high' 
                ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500' 
                : risk.level === 'medium'
                ? 'bg-yellow-600 hover:bg-yellow-700 focus:ring-yellow-500'
                : 'bg-green-600 hover:bg-green-700 focus:ring-green-500'
            }`}
          >
            Approve (⌘+Enter)
          </button>
        </div>

        {/* Shortcut hint */}
        <p className="mt-3 text-xs text-gray-500 text-center">
          Shortcuts: <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-200 rounded text-gray-700 font-mono">⌘+Enter</kbd> Approve · 
          <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-200 rounded text-gray-700 font-mono">Esc</kbd> Deny
        </p>
      </div>
    </div>
  );
}

// Standalone render function for use from background script
let confirmRoot: ReturnType<typeof createRoot> | null = null;
let confirmContainer: HTMLDivElement | null = null;

export function showConfirmation(
  context: ConfirmationContext
): Promise<boolean> {
  return new Promise((resolve) => {
    // Create container if needed
    if (!confirmContainer) {
      confirmContainer = document.createElement('div');
      document.body.appendChild(confirmContainer);
    }

    // Render with callbacks
    const root = createRoot(confirmContainer);
    confirmRoot = root;
    
    root.render(
      <Confirm
        context={{
          ...context,
          onApprove: () => {
            root.unmount();
            resolve(true);
          },
          onDeny: () => {
            root.unmount();
            resolve(false);
          }
        }}
      />
    );
  });
}

export function hideConfirmation(): void {
  if (confirmRoot) {
    confirmRoot.unmount();
    confirmRoot = null;
  }
}