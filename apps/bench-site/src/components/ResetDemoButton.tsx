import { useState } from 'react';

// One-click reset between demo runs: clears the site's local state.
export function ResetDemoButton({ onReset }: { onReset: () => Promise<void> | void }) {
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<string | null>(null);
  return (
    <span className="reset-demo">
      <button
        type="button"
        disabled={busy}
        onClick={() => void (async () => {
          setBusy(true);
          try {
            await onReset();
            setLast(new Date().toLocaleTimeString());
          } finally {
            setBusy(false);
          }
        })()}
      >
        {busy ? 'Resetting…' : 'Reset demo'}
      </button>
      {last && <span className="muted">reset at {last}</span>}
    </span>
  );
}
