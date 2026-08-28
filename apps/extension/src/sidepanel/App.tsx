import React from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  return (
    <div style={{ padding: 16, fontFamily: 'system-ui' }}>
      <h1>GLASSWALL</h1>
      <p>Side panel loaded successfully</p>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
const container = document.getElementById('root');
if (container instanceof HTMLElement) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  createRoot(container).render(<App />);
}
