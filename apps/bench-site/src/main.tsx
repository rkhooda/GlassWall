import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import ShopLiteApp from './sites/shoplite/App';
import GovPortalApp from './sites/govportal/App';
import ClinicDeskApp from './sites/clinicdesk/App';
import './styles.css';

// The bench shell: three local sites under one dev server. Every site reads its
// persona seed from ?seed= so runs are reproducible.
function Landing() {
  return (
    <main className="landing">
      <h1>GLASSWALL bench sites</h1>
      <p>Local, seeded pages used to develop and evaluate the privacy-preserving browser agent.</p>
      <ul>
        <li><Link to="/shoplite/?seed=1337">ShopLite</Link> — e-commerce: search, cart, checkout form, orders, prompt-injection page</li>
        <li><Link to="/govportal/?seed=1337">GovPortal</Link> — multi-step government application form</li>
        <li><Link to="/clinicdesk/?seed=1337">ClinicDesk</Link> — clinical records with PII rendered as canvas pixels and images</li>
      </ul>
      <p className="muted">Add <code>?seed=&lt;n&gt;</code> to any site URL to change the generated persona.</p>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/shoplite/*" element={<ShopLiteApp />} />
        <Route path="/govportal/*" element={<GovPortalApp />} />
        <Route path="/clinicdesk/*" element={<ClinicDeskApp />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
