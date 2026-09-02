import { Link } from 'react-router-dom';
import { generatePersona } from '../../../data/generator';
import { piiAttrs, piiAttrsSpan } from '../../../instrument';

interface PatientListPageProps {
  seed: number;
}

const PatientListPage = ({ seed }: PatientListPageProps) => {
  const persona = generatePersona(seed);

  const patients = [
    {
      id: 'P001',
      name: persona.values.find(v => v.type === 'PERSON_NAME')?.value || 'Rahul Sharma',
      mrn: persona.values.find(v => v.type === 'MRN')?.value || 'MRN-000001',
      phone: persona.values.find(v => v.type === 'PHONE')?.value?.replace(/\s/g, '') || '+919876543210',
      dob: persona.values.find(v => v.type === 'DOB')?.value || '1990-01-01',
    },
    {
      id: 'P002',
      name: 'Priya Patel',
      mrn: 'MRN-000002',
      phone: '+918765432109',
      dob: '1985-05-15',
    },
    {
      id: 'P003',
      name: 'Arjun Singh',
      mrn: 'MRN-000003',
      phone: '+917654321098',
      dob: '1992-11-30',
    },
  ];

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
                <span {...piiAttrsSpan('PERSON_NAME', 3, persona.values.find(v => v.type === 'PERSON_NAME')?.value_id || 'v_1')}>
                  {patient.name}
                </span>
              </td>
              <td>
                <span {...piiAttrsSpan('MRN', 2, persona.values.find(v => v.type === 'MRN')?.value_id || 'v_2')}>
                  {patient.mrn}
                </span>
              </td>
              <td>
                <span {...piiAttrsSpan('PHONE', 2, persona.values.find(v => v.type === 'PHONE')?.value_id || 'v_3')}>
                  {patient.phone}
                </span>
              </td>
              <td>
                <span {...piiAttrsSpan('DOB', 3, persona.values.find(v => v.type === 'DOB')?.value_id || 'v_4')}>
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