import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import PatientListPage from './pages/PatientListPage';
import PatientDetailPage from './pages/PatientDetailPage';
import './clinicdesk.css';

function App() {
  const [seed] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return parseInt(params.get('seed') || '42', 10);
  });
  const navigate = useNavigate();

  return (
    <BrowserRouter>
      <div className="clinicdesk-app">
        <header className="clinicdesk-header">
          <h1>ClinicDesk</h1>
          <div className="seed-display">
            Seed: <code>{seed}</code>
            <button onClick={() => navigate(`?seed=${seed}`)}>Reload</button>
          </div>
        </header>
        <main>
          <Routes>
            <Route
              path="/"
              element={<PatientListPage seed={seed} />}
            />
            <Route
              path="/patient/:patientId"
              element={<PatientDetailPage seed={seed} />}
            />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;