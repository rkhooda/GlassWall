import { Routes, Route, Link } from 'react-router-dom';
import { useMemo } from 'react';
import PatientListPage from './pages/PatientListPage';
import PatientDetailPage from './pages/PatientDetailPage';
import './clinicdesk.css';

// ClinicDesk: clinical records with PII rendered as canvas pixels, images and
// free text. Mounted under /clinicdesk by the bench shell.
export default function ClinicDeskApp() {
  const seed = useMemo(() => {
    const raw = new URLSearchParams(window.location.search).get('seed');
    return raw && /^\d+$/.test(raw) ? parseInt(raw, 10) : 1337;
  }, []);

  return (
    <div className="clinicdesk-app">
      <header className="clinicdesk-header">
        <h1><Link to={`/clinicdesk/?seed=${seed}`}>ClinicDesk</Link></h1>
        <div className="seed-display">Seed: <code>{seed}</code></div>
      </header>
      <main>
        <Routes>
          <Route index element={<PatientListPage seed={seed} />} />
          <Route path="patient/:patientId" element={<PatientDetailPage seed={seed} />} />
        </Routes>
      </main>
    </div>
  );
}
