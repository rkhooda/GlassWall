import { Link } from 'react-router-dom';
import { generatePersona, patientSeed, PATIENT_IDS } from '../../../data/generator';
import { piiAttrs, piiAttrsSpan } from '../../../instrument';

interface PatientListPageProps {
  seed: number;
}

const PatientListPage = ({ seed }: PatientListPageProps) => {
  // Each row uses its own persona (keyed off patientId) so the list matches
  // whatever PatientDetailPage renders for that same patient.
  const personas = PATIENT_IDS.map(id => ({ id, persona: generatePersona(patientSeed(seed, id)) }));
  const persona = personas[0]!.persona;

  const patients = personas.map(({ id, persona: p }) => {
    const nameVal = p.values.find(v => v.type === 'PERSON_NAME');
    const mrnVal = p.values.find(v => v.type === 'MRN');
    const phoneVal = p.values.find(v => v.type === 'PHONE');
    const dobVal = p.values.find(v => v.type === 'DOB');
    return {
      id,
      name: nameVal?.value || '',
      nameId: nameVal?.value_id || 'v_1',
      mrn: mrnVal?.value || '',
      mrnId: mrnVal?.value_id || 'v_2',
      phone: phoneVal?.value?.replace(/\s/g, '') || '',
      phoneId: phoneVal?.value_id || 'v_3',
      dob: dobVal?.value || '',
      dobId: dobVal?.value_id || 'v_4',
    };
  });

  return (
    <div className="patient-list-page">
      <h2>Patient List</h2>
      <table className="patient-table">
        <thead>
          <tr>
            <th>Patient ID</th>
            <th>Name</th>
            <th>MRN</th>
            <th>Phone</th>
            <th>DOB</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {patients.map((patient) => (
            <tr key={patient.id}>
              <td><code>{patient.id}</code></td>
              <td>
                <span {...piiAttrsSpan('PERSON_NAME', 3, patient.nameId)}>
                  {patient.name}
                </span>
              </td>
              <td>
                <span {...piiAttrsSpan('MRN', 2, patient.mrnId)}>
                  {patient.mrn}
                </span>
              </td>
              <td>
                <span {...piiAttrsSpan('PHONE', 2, patient.phoneId)}>
                  {patient.phone}
                </span>
              </td>
              <td>
                <span {...piiAttrsSpan('DOB', 3, patient.dobId)}>
                  {patient.dob}
                </span>
              </td>
              <td>
                <Link to={`/clinicdesk/patient/${patient.id}`} className="btn btn-sm">View</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="near-miss-section">
        <h3>Near-Miss Decoys (Should NOT be detected)</h3>
        <div className="decoy-grid">
          {persona.decoys.map((decoy, idx) => (
            <div key={idx} className="decoy-item" {...piiAttrs(decoy.type as any, decoy.tier, decoy.value_id, { decoy: true })}>
              <label>{decoy.type}:</label>
              <code>{decoy.value}</code>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default PatientListPage;