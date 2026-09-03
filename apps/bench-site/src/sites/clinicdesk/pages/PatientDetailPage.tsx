import { useParams } from 'react-router-dom';
import { generatePersona, patientSeed } from '../../../data/generator';
import type { Region } from '../../../instrument';
import { piiAttrs, piiAttrsSpan, piiAttrsCanvas, piiAttrsImage, piiAttrsTextBlock } from '../../../instrument';
import { useEffect, useRef, useState } from 'react';

interface PatientDetailPageProps {
  seed: number;
}

const PatientDetailPage = ({ seed }: PatientDetailPageProps) => {
  const { patientId } = useParams<{ patientId: string }>();
  const persona = generatePersona(patientSeed(seed, patientId || 'P001'));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [prescriptionDataUrl, setPrescriptionDataUrl] = useState<string>('');

  // Extract values from persona
  const getVal = (type: string) => persona.values.find(v => v.type === type)?.value || '';
  const getId = (type: string) => persona.values.find(v => v.type === type)?.value_id || '';

  const fullName = getVal('PERSON_NAME');
  const nameId = getId('PERSON_NAME');
  const phone = getVal('PHONE');
  const phoneId = getId('PHONE');
  const aadhaar = getVal('AADHAAR');
  const aadhaarId = getId('AADHAAR');
  const mrn = getVal('MRN');
  const dob = getVal('DOB');
  const address = getVal('STREET_ADDRESS');
  const addressId = getId('STREET_ADDRESS');
  const city = persona.values.find(v => v.type === 'STREET_ADDRESS' && v.value_id !== addressId)?.value || 'Bangalore';
  const cityId = persona.values.find(v => v.type === 'STREET_ADDRESS' && v.value_id !== addressId)?.value_id || 'v_0';
  const state = persona.values.find(v => v.type === 'STREET_ADDRESS' && v.value_id !== addressId && v.value_id !== cityId)?.value || 'KA';
  const stateId = persona.values.find(v => v.type === 'STREET_ADDRESS' && v.value_id !== addressId && v.value_id !== cityId)?.value_id || 'v_0';
  const pin = getVal('POSTAL_CODE');
  const pinId = getId('POSTAL_CODE');

  // Canvas regions for lab report
  const labRegions: Region[] = [
    { x: 20, y: 30, w: 250, h: 24, pii: 'PERSON_NAME', value_id: nameId },
    { x: 20, y: 70, w: 200, h: 20, pii: 'AADHAAR', value_id: aadhaarId },
    { x: 20, y: 110, w: 180, h: 20, pii: 'PHONE', value_id: phoneId },
  ];

  // Draw lab report on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size (CSS pixels * DPR for crisp rendering)
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = 400;
    const cssHeight = 200;
    canvas.width = cssWidth * dpr;
    canvas.height = cssHeight * dpr;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    // Border
    ctx.strokeStyle = '#ddd';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, cssWidth - 1, cssHeight - 1);

    // Header
    ctx.fillStyle = '#1a73e8';
    ctx.fillRect(0, 0, cssWidth, 40);
    ctx.fillStyle = 'white';
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('LAB REPORT — ClinicDesk Diagnostics', 20, 20);

    // Patient info
    ctx.fillStyle = '#333';
    ctx.font = '14px system-ui, sans-serif';
    ctx.textBaseline = 'top';

    ctx.fillText('Patient:', 20, 50);
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.fillText(fullName, 100, 50);

    ctx.font = '14px system-ui, sans-serif';
    ctx.fillText('Aadhaar:', 20, 90);
    ctx.font = 'bold 14px monospace';
    ctx.fillText(aadhaar.replace(/(\d{4})(\d{4})(\d{4})/, '$1 $2 $3'), 100, 90);

    ctx.font = '14px system-ui, sans-serif';
    ctx.fillText('Phone:', 20, 130);
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.fillText(phone, 100, 130);

    ctx.font = '14px system-ui, sans-serif';
    ctx.fillText('MRN:', 20, 170);
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.fillText(mrn, 100, 170);

    // Lab results table header
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(20, 210, 360, 30);
    ctx.fillStyle = '#333';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.fillText('Test', 30, 218);
    ctx.fillText('Result', 180, 218);
    ctx.fillText('Ref Range', 300, 218);

    // Lab results
    const results = [
      { test: 'Hemoglobin', result: '14.2 g/dL', ref: '13.5-17.5' },
      { test: 'WBC Count', result: '7.8 K/uL', ref: '4.5-11.0' },
      { test: 'Platelets', result: '280 K/uL', ref: '150-450' },
      { test: 'Glucose (Fasting)', result: '92 mg/dL', ref: '70-100' },
      { test: 'Creatinine', result: '0.9 mg/dL', ref: '0.6-1.2' },
    ];

    results.forEach((r, i) => {
      const y = 250 + i * 28;
      ctx.fillStyle = i % 2 === 0 ? '#fff' : '#fafafa';
      ctx.fillRect(20, y - 8, 360, 28);
      ctx.fillStyle = '#333';
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText(r.test, 30, y);
      ctx.fillText(r.result, 180, y);
      ctx.fillText(r.ref, 300, y);
    });

    // Footer
    ctx.fillStyle = '#999';
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillText('Report generated by ClinicDesk v1.0 — Not valid for medico-legal purposes', 20, cssHeight - 10);
  }, [fullName, aadhaar, phone, mrn]);

  // Generate prescription image data URL
  useEffect(() => {
    const canvas = document.createElement('canvas');
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = 500;
    const cssHeight = 350;
    canvas.width = cssWidth * dpr;
    canvas.height = cssHeight * dpr;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    // Header
    ctx.fillStyle = '#2e7d32';
    ctx.fillRect(0, 0, cssWidth, 50);
    ctx.fillStyle = 'white';
    ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('ClinicDesk — Prescription', 20, 25);

    // Doctor info
    ctx.fillStyle = '#333';
    ctx.font = '13px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText('Dr. Anjali Mehta, MD', 20, 70);
    ctx.fillText('Reg. No: KMC-12345', 20, 90);
    ctx.fillText('Date: ' + new Date().toLocaleDateString('en-IN'), 20, 110);

    // Patient info
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillText('Patient:', 20, 140);
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText(fullName, 100, 140);
    ctx.fillText(`Age: ${new Date().getFullYear() - new Date(dob).getFullYear()}  Sex: M`, 100, 160);

    // Prescription divider
    ctx.strokeStyle = '#ddd';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(20, 190);
    ctx.lineTo(cssWidth - 20, 190);
    ctx.stroke();

    // Rx symbol
    ctx.font = 'bold 24px system-ui, sans-serif';
    ctx.fillStyle = '#2e7d32';
    ctx.fillText('℞', 20, 230);

    // Medications
    const meds = [
      'Tab. Metformin 500mg — 1-0-1 after food × 30 days',
      'Tab. Atorvastatin 10mg — 0-0-1 at bedtime × 30 days',
      'Tab. Aspirin 75mg — 1-0-0 after breakfast × 30 days',
      'Syr. Vitamin D3 60K IU — 1 sachet weekly × 4 weeks',
    ];

    ctx.font = '13px system-ui, sans-serif';
    ctx.fillStyle = '#333';
    meds.forEach((med, i) => {
      ctx.fillText(med, 50, 230 + i * 30);
    });

    // Footer
    ctx.strokeStyle = '#ddd';
    ctx.beginPath();
    ctx.moveTo(20, 320);
    ctx.lineTo(cssWidth - 20, 320);
    ctx.stroke();

    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = '#666';
    ctx.fillText('Dispense as prescribed. Review in 30 days.', 20, 335);
    ctx.fillText('Dr. Anjali Mehta (Digital Signature)', 20, 350);

    setPrescriptionDataUrl(canvas.toDataURL('image/png'));
  }, [fullName, dob]);

  // Prescription image regions
  const rxRegions: Region[] = [
    { x: 100, y: 140, w: 200, h: 18, pii: 'PERSON_NAME', value_id: nameId },
  ];

  // Clinical notes paragraph
  const clinicalNotes = persona.clinicalParagraph;

  return (
    <div className="patient-detail-page" data-glasswall-pii="NONE" data-glasswall-tier="3" data-glasswall-value-id="v_0">
      <div className="page-header">
        <h2>Patient Detail: <span {...piiAttrsSpan('PERSON_NAME', 3, nameId)}>{fullName}</span></h2>
        <span className="patient-id">ID: {patientId}</span>
      </div>

      <div className="detail-grid">
        {/* Left column - Lab Report Canvas */}
        <section className="card" aria-labelledby="lab-report-heading">
          <h3 id="lab-report-heading">Lab Report (Canvas)</h3>
          <div className="canvas-container">
            <canvas
              ref={canvasRef}
              id="lab-report-canvas"
              width="400"
              height="400"
              {...piiAttrsCanvas(labRegions)}
            >
              Your browser does not support canvas.
            </canvas>
          </div>
          <div className="canvas-legend">
            <p>Regions (CSS px relative to canvas):</p>
            <ul>
              {labRegions.map((r, i) => (
                <li key={i}>
                  {r.pii} at ({r.x}, {r.y}) {r.w}×{r.h} — value_id: {r.value_id}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Right column - Prescription Image */}
        <section className="card" aria-labelledby="prescription-heading">
          <h3 id="prescription-heading">Prescription (Image)</h3>
          <div className="image-container">
            {prescriptionDataUrl ? (
              <img
                id="prescription-img"
                src={prescriptionDataUrl}
                alt="Prescription"
                width="500"
                height="350"
                {...piiAttrsImage(rxRegions)}
              />
            ) : (
              <div className="placeholder">Generating prescription...</div>
            )}
          </div>
          <div className="image-legend">
            <p>Regions (CSS px relative to image):</p>
            <ul>
              {rxRegions.map((r, i) => (
                <li key={i}>
                  {r.pii} at ({r.x}, {r.y}) {r.w}×{r.h} — value_id: {r.value_id}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Full width - Clinical Notes */}
        <section className="card full-width" aria-labelledby="clinical-notes-heading">
          <h3 id="clinical-notes-heading">Clinical Notes (Free Text)</h3>
          <div className="clinical-notes" {...piiAttrsTextBlock()}>
            {clinicalNotes.split(' ').map((word, i) => {
              // Check if this word contains PII
              const nameParts = fullName.split(' ');
              const addressParts = address.split(' ');
              const phoneParts = phone.split(/[\s-]+/);

              let piiType = 'NONE';
              let tier: 1 | 2 | 3 = 3;
              let valueId = 'v_0';

              if (nameParts.some(p => word.includes(p))) {
                piiType = 'PERSON_NAME';
                tier = 3;
                valueId = nameId;
              } else if (addressParts.some(p => word.includes(p))) {
                piiType = 'STREET_ADDRESS';
                tier = 3;
                valueId = addressId;
              } else if (phoneParts.some(p => word.includes(p))) {
                piiType = 'PHONE';
                tier = 2;
                valueId = phoneId;
              } else if (word.includes(city)) {
                piiType = 'STREET_ADDRESS';
                tier = 3;
                valueId = cityId;
              } else if (word.includes(state)) {
                piiType = 'STREET_ADDRESS';
                tier = 3;
                valueId = stateId;
              } else if (word.includes(pin)) {
                piiType = 'POSTAL_CODE';
                tier = 3;
                valueId = pinId;
              }

              if (piiType !== 'NONE') {
                return (
                  <span key={i} {...piiAttrsSpan(piiType as any, tier, valueId)}>
                    {word}
                  </span>
                );
              }
              return <span key={i}>{word}</span>;
            })}
          </div>
        </section>

        {/* Cross-origin iframe placeholder */}
        <section className="card full-width" aria-labelledby="iframe-heading">
          <h3 id="iframe-heading">Insurance Portal (Cross-Origin Iframe Placeholder)</h3>
          <div className="iframe-placeholder">
            <iframe
              title="Insurance Portal (Cross-Origin)"
              width="100%"
              height="200"
              sandbox="allow-scripts allow-same-origin allow-forms"
              srcDoc={`
                <!DOCTYPE html>
                <html>
                <head>
                  <meta charset="UTF-8">
                  <title>Insurance Portal</title>
                  <style>
                    body { font-family: system-ui, sans-serif; margin: 20px; background: #f5f5f5; }
                    .card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
                    .field { margin-bottom: 15px; }
                    label { display: block; margin-bottom: 5px; font-weight: 500; }
                    input, select { width: 100%; padding: 10px; box-sizing: border-box; border: 1px solid #ddd; border-radius: 4px; }
                    .pii-field { background: #fff8e1; }
                  </style>
                </head>
                <body>
                  <div class="card">
                    <h3>Insurance Claim Form</h3>
                    <div class="field">
                      <label for="claim-patient-name">Patient Name:</label>
                      <input type="text" id="claim-patient-name" class="pii-field" value="${fullName}" readonly />
                    </div>
                    <div class="field">
                      <label for="claim-aadhaar">Aadhaar:</label>
                      <input type="text" id="claim-aadhaar" class="pii-field" value="${aadhaar.replace(/(\d{4})(\d{4})(\d{4})/, '$1 $2 $3')}" readonly />
                    </div>
                    <div class="field">
                      <label for="claim-phone">Phone:</label>
                      <input type="tel" id="claim-phone" class="pii-field" value="${phone}" readonly />
                    </div>
                    <div class="field">
                      <label for="claim-policy">Policy Number:</label>
                      <input type="text" id="claim-policy" value="POL-${Math.random().toString(36).substr(2, 9).toUpperCase()}" readonly />
                    </div>
                  </div>
                </body>
                </html>
              `}
            />
            <p className="iframe-note">This is a cross-origin iframe — content is not accessible to DOM extraction.</p>
          </div>
        </section>

        {/* SVG with text */}
        <section className="card full-width" aria-labelledby="svg-heading">
          <h3 id="svg-heading">Consent Form (SVG with Text)</h3>
          <div className="svg-container">
            <svg
              width="600"
              height="200"
              viewBox="0 0 600 200"
              xmlns="http://www.w3.org/2000/svg"
              role="img"
              aria-label="Consent form with patient details"
            >
              <defs>
                <style>{`
                  .form-bg { fill: #fafafa; stroke: #ddd; stroke-width: 1; }
                  .form-header { fill: #1a73e8; }
                  .form-text { fill: #333; font-family: system-ui, sans-serif; font-size: 14px; }
                  .form-text-bold { fill: #333; font-family: system-ui, sans-serif; font-size: 14px; font-weight: bold; }
                  .pii-text { fill: #333; font-family: system-ui, sans-serif; font-size: 14px; font-weight: bold; }
                `}</style>
              </defs>
              <rect className="form-bg" x="0.5" y="0.5" width="599" height="199" rx="4" />
              <rect className="form-header" x="0" y="0" width="600" height="40" rx="4" />
              <text x="20" y="26" fill="white" fontFamily="system-ui, sans-serif" fontSize="16" fontWeight="bold">
                CONSENT FOR TREATMENT
              </text>

              <text x="20" y="70" className="form-text">I,</text>
              <text x="50" y="70" className="pii-text" {...piiAttrsSpan('PERSON_NAME', 3, nameId)}>{fullName}</text>
              <text x="20" y="95" className="form-text">
                residing at
              </text>
              <text x="20" y="115" className="pii-text" {...piiAttrsSpan('STREET_ADDRESS', 3, addressId)}>{address}</text>
              <text x="20" y="135" className="pii-text" {...piiAttrsSpan('STREET_ADDRESS', 3, cityId)}>{city}</text>
              <text x="200" y="135" className="pii-text" {...piiAttrsSpan('STREET_ADDRESS', 3, stateId)}>{state}</text>
              <text x="300" y="135" className="pii-text" {...piiAttrsSpan('POSTAL_CODE', 3, pinId)}>{pin}</text>
              <text x="20" y="155" className="form-text">
                contact:
              </text>
              <text x="80" y="155" className="pii-text" {...piiAttrsSpan('PHONE', 2, phoneId)}>{phone}</text>
              <text x="20" y="175" className="form-text">
                hereby consent to the proposed treatment.
              </text>
            </svg>
          </div>
        </section>

        {/* Near-miss section in detail view */}
        <section className="card full-width near-miss-detail" aria-labelledby="nearmiss-heading">
          <h3 id="nearmiss-heading">Near-Miss Decoys in Detail View</h3>
          <div className="decoy-list">
            <div className="decoy-row" {...piiAttrs('AADHAAR', 2, persona.decoys.find(d => d.type === 'AADHAAR')?.value_id || 'v_999', { decoy: true })}>
              <span className="decoy-label">Fake Aadhaar (fails Verhoeff):</span>
              <code className="decoy-value">{persona.decoys.find(d => d.type === 'AADHAAR')?.value}</code>
            </div>
            <div className="decoy-row" {...piiAttrs('CARD', 2, persona.decoys.find(d => d.type === 'CARD')?.value_id || 'v_998', { decoy: true })}>
              <span className="decoy-label">Fake Card (fails Luhn):</span>
              <code className="decoy-value">{persona.decoys.find(d => d.type === 'CARD')?.value}</code>
            </div>
            <div className="decoy-row" {...piiAttrs('PAN', 2, persona.decoys.find(d => d.type === 'PAN')?.value_id || 'v_997', { decoy: true })}>
              <span className="decoy-label">PAN-shaped SKU:</span>
              <code className="decoy-value">{persona.decoys.find(d => d.type === 'PAN')?.value}</code>
            </div>
            <div className="decoy-row" {...piiAttrs('POSTAL_CODE', 3, persona.decoys.find(d => d.type === 'POSTAL_CODE')?.value_id || 'v_996', { decoy: true })}>
              <span className="decoy-label">6-digit Order Number (looks like PIN):</span>
              <code className="decoy-value">{persona.decoys.find(d => d.type === 'POSTAL_CODE')?.value}</code>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default PatientDetailPage;