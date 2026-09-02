import { GovPortalPage } from './page';

// GovPortal: a multi-step government application form. Mounted under /govportal.
export default function GovPortalApp() {
  return (
    <div className="site govportal">
      <header className="site-header"><span className="logo">GovPortal</span></header>
      <main className="site-main"><GovPortalPage /></main>
    </div>
  );
}
