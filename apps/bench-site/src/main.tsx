import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './sites/govportal/App';

// Import ShopLite app for reference/testing (commented out)
// import App from './sites/shoplite/App';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);