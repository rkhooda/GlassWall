const SEED_PRIME = 0x9e3779b9;

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return function () {
    t += SEED_PRIME;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function pickWeighted<T>(rng: () => number, items: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

function shuffle<T>(rng: () => number, arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
const INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

function verhoeffCheckDigit(digits: number[]): number {
  let c = 0;
  for (let i = 0; i < digits.length; i++) {
    const digit = digits[digits.length - 1 - i];
    c = D[c][P[(i + 1) % 8][digit]];
  }
  return INV[c];
}

function verifyVerhoeff(num: string): boolean {
  const digits = num.split('').map(Number);
  let c = 0;
  for (let i = 0; i < digits.length; i++) {
    const digit = digits[digits.length - 1 - i];
    c = D[c][P[i % 8][digit]];
  }
  return c === 0;
}

function luhnCheckDigit(digits: number[]): number {
  let sum = 0;
  let double = true;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits[i];
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return (10 - (sum % 10)) % 10;
}

function verifyLuhn(num: string): boolean {
  const digits = num.split('').map(Number);
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits[i];
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

function gstinCheckChar(gstin14: string): string {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const charToVal: Record<string, number> = {};
  for (let i = 0; i < chars.length; i++) charToVal[chars[i]] = i;
  const weights = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const val = charToVal[gstin14[i]];
    sum += val * weights[i];
  }
  const checkVal = (36 - (sum % 36)) % 36;
  return chars[checkVal];
}

function verifyGstin(gstin: string): boolean {
  if (gstin.length !== 15) return false;
  return gstin[14] === gstinCheckChar(gstin.slice(0, 14));
}

const FIRST_NAMES = [
  'Rahul', 'Priya', 'Arjun', 'Anjali', 'Vikram', 'Neha', 'Karan', 'Pooja',
  'Amit', 'Sunita', 'Rajesh', 'Kavita', 'Sanjay', 'Meera', 'Deepak', 'Shreya',
  'Manoj', 'Divya', 'Rohit', 'Swati', 'Nitin', 'Ankita', 'Suresh', 'Ritu',
  'Ajay', 'Preeti', 'Vivek', 'Nisha', 'Pankaj', 'Jyoti'
];

const LAST_NAMES = [
  'Sharma', 'Patel', 'Singh', 'Kumar', 'Gupta', 'Agarwal', 'Verma', 'Jain',
  'Reddy', 'Nair', 'Iyer', 'Rao', 'Mehta', 'Joshi', 'Desai', 'Shah',
  'Chopra', 'Malhotra', 'Bhatia', 'Sethi', 'Kapoor', 'Khanna', 'Arora', 'Bansal',
  'Mittal', 'Goyal', 'Bansal', 'Agarwal', 'Sinha', 'Mishra'
];

const STREETS = [
  'MG Road', 'Brigade Road', 'Residency Road', 'Church Street', 'Commercial Street',
  'Cunningham Road', 'Richmond Road', 'Lavelle Road', 'Vittal Mallya Road',
  'Koramangala', 'Indiranagar', 'Jayanagar', 'Whitefield', 'Electronic City',
  'Hebbal', 'Yelahanka', 'Marathahalli', 'BTM Layout', 'HSR Layout', 'Sarjapur Road'
];

const CITIES = [
  'Bangalore', 'Mumbai', 'Delhi', 'Hyderabad', 'Chennai', 'Kolkata', 'Pune', 'Ahmedabad',
  'Jaipur', 'Lucknow', 'Kanpur', 'Nagpur', 'Indore', 'Bhopal', 'Visakhapatnam', 'Patna'
];

const STATES = [
  'KA', 'MH', 'DL', 'TG', 'TN', 'WB', 'MH', 'GJ', 'RJ', 'UP', 'UP', 'MH', 'MP', 'MP', 'AP', 'BR'
];

const PINS = [
  '560001', '400001', '110001', '500001', '600001', '700001', '411001', '380001',
  '302001', '226001', '208001', '440001', '452001', '462001', '530001', '800001'
];

const BANKS = [
  { code: 'SBIN', name: 'State Bank of India' },
  { code: 'HDFC', name: 'HDFC Bank' },
  { code: 'ICIC', name: 'ICICI Bank' },
  { code: 'UTIB', name: 'Axis Bank' },
  { code: 'KKBK', name: 'Kotak Mahindra Bank' },
  { code: 'YESB', name: 'Yes Bank' },
  { code: 'INDB', name: 'IndusInd Bank' },
  { code: 'RATN', name: 'RBL Bank' },
];

const UPI_HANDLES = [
  'okhdfcbank', 'oksbi', 'okicici', 'okaxis', 'okkotak', 'okyesbank',
  'paytm', 'phonepe', 'gpay', 'amazonpay', 'mobikwik', 'freecharge'
];

const CARD_PREFIXES = {
  visa: ['4'],
  mastercard: ['51', '52', '53', '54', '55'],
  amex: ['34', '37'],
  rupay: ['60', '65'],
};

function generateIndianPhone(rng: () => number): { national: string; e164: string } {
  const firstDigit = pick(rng, [6, 7, 8, 9]);
  const rest = Array.from({ length: 9 }, () => Math.floor(rng() * 10)).join('');
  const national = `${firstDigit}${rest}`;
  return { national, e164: `+91 ${firstDigit}${rest.slice(0, 5)} ${rest.slice(5)}` };
}

function generateAadhaar(rng: () => number): string {
  const digits = Array.from({ length: 11 }, () => Math.floor(rng() * 10));
  const check = verhoeffCheckDigit(digits);
  digits.push(check);
  return digits.join('');
}

function generatePan(rng: () => number): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const fifthChar = pick(rng, ['P', 'C', 'H', 'F', 'A', 'T', 'B', 'L', 'J', 'G']);
  const fourthChar = pick(rng, letters.split(''));
  const firstThree = Array.from({ length: 3 }, () => pick(rng, letters.split(''))).join('');
  const lastFour = Array.from({ length: 4 }, () => Math.floor(rng() * 10)).join('');
  const lastChar = pick(rng, letters.split(''));
  return `${firstThree}${fourthChar}${fifthChar}${lastFour}${lastChar}`;
}

function generateIfsc(rng: () => number): string {
  const bank = pick(rng, BANKS);
  const branch = Array.from({ length: 6 }, () => Math.floor(rng() * 10)).join('');
  return `${bank.code}0${branch}`;
}

function generateGstin(rng: () => number): string {
  const stateCode = pick(rng, ['29', '27', '07', '36', '33', '19', '24', '09', '08', '23']);
  const pan = generatePan(rng);
  const entity = pick(rng, ['1', '2', '3']);
  const checkChar = 'Z';
  const base14 = `${stateCode}${pan}${entity}${checkChar}`;
  const correctCheck = gstinCheckChar(base14);
  return base14 + correctCheck;
}

function generateUpi(rng: () => number): string {
  const name = pick(rng, FIRST_NAMES).toLowerCase();
  const handle = pick(rng, UPI_HANDLES);
  return `${name}.${Math.floor(rng() * 1000)}@${handle}`;
}

function generateCard(rng: () => number): string {
  const type = pickWeighted(rng, ['visa', 'mastercard', 'rupay', 'amex'], [0.5, 0.3, 0.15, 0.05]);
  const prefixes = CARD_PREFIXES[type as keyof typeof CARD_PREFIXES];
  const prefix = pick(rng, prefixes);
  const length = type === 'amex' ? 15 : 16;
  const remaining = length - prefix.length - 1;
  const digits = prefix.split('').map(Number);
  for (let i = 0; i < remaining; i++) digits.push(Math.floor(rng() * 10));
  const check = luhnCheckDigit(digits);
  digits.push(check);
  return digits.join('');
}

function generateDob(rng: () => number): string {
  const year = 1950 + Math.floor(rng() * 55);
  const month = 1 + Math.floor(rng() * 12);
  const day = 1 + Math.floor(rng() * 28);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function generateAddress(rng: () => number): { street: string; city: string; state: string; pin: string } {
  const street = pick(rng, STREETS);
  const idx = Math.floor(rng() * CITIES.length);
  return {
    street: `${Math.floor(rng() * 999) + 1} ${street}`,
    city: CITIES[idx],
    state: STATES[idx],
    pin: PINS[idx],
  };
}

function generateIpv4(rng: () => number): string {
  return Array.from({ length: 4 }, () => Math.floor(rng() * 256)).join('.');
}

function generateSecret(rng: () => number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const prefix = pick(rng, ['sk_', 'pk_', 'api_', 'token_', 'secret_', 'key_']);
  const len = 32 + Math.floor(rng() * 32);
  let out = prefix;
  for (let i = 0; i < len; i++) out += pick(rng, chars.split(''));
  return out;
}

function generateMrn(rng: () => number): string {
  const prefix = pick(rng, ['MRN', 'PAT', 'CLIN', 'HOSP', 'OPD', 'IPD']);
  const num = String(Math.floor(rng() * 1000000)).padStart(6, '0');
  return `${prefix}-${num}`;
}

function generateClinicalParagraph(rng: () => number, name: string, address: string): string {
  const templates = [
    `Patient ${name} presented with acute abdominal pain. Resides at ${address}. History of hypertension.`,
    `${name}, a 45-year-old male, reports chest discomfort. Address on file: ${address}. No known allergies.`,
    `Follow-up for ${name}. Previous admission for diabetes management. Current address: ${address}.`,
    `Emergency consult for ${name}. Trauma from MVA. Home address: ${address}. Contact next of kin.`,
    `Routine checkup for ${name}. Blood work ordered. Residential address: ${address}.`,
  ];
  return pick(rng, templates);
}

export interface PersonaValue {
  value: string;
  type: string;
  tier: 1 | 2 | 3;
  value_id: string;
  decoy?: boolean;
}

export interface Persona {
  seed: number;
  values: PersonaValue[];
  decoys: PersonaValue[];
  clinicalParagraph: string;
}

let valueIdCounter = 0;
function nextValueId(): string {
  return `v_${++valueIdCounter}`;
}

function resetValueIdCounter(): void {
  valueIdCounter = 0;
}

export function generatePersona(seed: number): Persona {
  const rng = mulberry32(seed);
  resetValueIdCounter();

  const firstName = pick(rng, FIRST_NAMES);
  const lastName = pick(rng, LAST_NAMES);
  const fullName = `${firstName} ${lastName}`;

  const { national: phoneNational, e164: phoneE164 } = generateIndianPhone(rng);
  const aadhaar = generateAadhaar(rng);
  const pan = generatePan(rng);
  const ifsc = generateIfsc(rng);
  const gstin = generateGstin(rng);
  const upi = generateUpi(rng);
  const card = generateCard(rng);
  const dob = generateDob(rng);
  const addr = generateAddress(rng);
  const ip = generateIpv4(rng);
  const secret = generateSecret(rng);
  const mrn = generateMrn(rng);
  const clinicalParagraph = generateClinicalParagraph(rng, fullName, addr.street);

  const values: PersonaValue[] = [
    { value: fullName, type: 'PERSON_NAME', tier: 3, value_id: nextValueId() },
    { value: phoneE164, type: 'PHONE', tier: 2, value_id: nextValueId() },
    { value: aadhaar, type: 'AADHAAR', tier: 2, value_id: nextValueId() },
    { value: pan, type: 'PAN', tier: 2, value_id: nextValueId() },
    { value: ifsc, type: 'IFSC', tier: 2, value_id: nextValueId() },
    { value: gstin, type: 'GSTIN', tier: 2, value_id: nextValueId() },
    { value: upi, type: 'UPI', tier: 2, value_id: nextValueId() },
    { value: card, type: 'CARD', tier: 2, value_id: nextValueId() },
    { value: dob, type: 'DOB', tier: 3, value_id: nextValueId() },
    { value: addr.street, type: 'STREET_ADDRESS', tier: 3, value_id: nextValueId() },
    { value: addr.pin, type: 'POSTAL_CODE', tier: 3, value_id: nextValueId() },
    { value: ip, type: 'IP', tier: 3, value_id: nextValueId() },
    { value: secret, type: 'SECRET', tier: 1, value_id: nextValueId() },
    { value: mrn, type: 'MRN', tier: 2, value_id: nextValueId() },
    { value: phoneNational, type: 'PHONE', tier: 2, value_id: nextValueId() },
    { value: addr.city, type: 'STREET_ADDRESS', tier: 3, value_id: nextValueId() },
    { value: addr.state, type: 'STREET_ADDRESS', tier: 3, value_id: nextValueId() },
  ];

  const decoys = generateDecoysInternal(rng);

  return { seed, values, decoys, clinicalParagraph };
}

function generateDecoysInternal(rng: () => number): PersonaValue[] {
  const decoys: PersonaValue[] = [];

  let aadhaarDecoy: string;
  do {
    aadhaarDecoy = Array.from({ length: 12 }, () => Math.floor(rng() * 10)).join('');
  } while (verifyVerhoeff(aadhaarDecoy));
  decoys.push({ value: aadhaarDecoy, type: 'AADHAAR', tier: 2, value_id: nextValueId(), decoy: true });

  let cardDecoy: string;
  do {
    const type = pickWeighted(rng, ['visa', 'mastercard', 'rupay', 'amex'], [0.5, 0.3, 0.15, 0.05]);
    const prefixes = CARD_PREFIXES[type as keyof typeof CARD_PREFIXES];
    const prefix = pick(rng, prefixes);
    const length = type === 'amex' ? 15 : 16;
    const remaining = length - prefix.length - 1;
    const digits = prefix.split('').map(Number);
    for (let i = 0; i < remaining; i++) digits.push(Math.floor(rng() * 10));
    const check = luhnCheckDigit(digits);
    digits.push((check + 1 + Math.floor(rng() * 9)) % 10);
    cardDecoy = digits.join('');
  } while (verifyLuhn(cardDecoy));
  decoys.push({ value: cardDecoy, type: 'CARD', tier: 2, value_id: nextValueId(), decoy: true });

  const panDecoy = `PRODU${Array.from({ length: 4 }, () => Math.floor(rng() * 10)).join('')}X`;
  decoys.push({ value: panDecoy, type: 'PAN', tier: 2, value_id: nextValueId(), decoy: true });

  const orderNum = String(Math.floor(rng() * 1000000)).padStart(6, '0');
  if (!PINS.includes(orderNum)) {
    decoys.push({ value: orderNum, type: 'POSTAL_CODE', tier: 3, value_id: nextValueId(), decoy: true });
  }

  return decoys;
}

export function generateDecoys(seed: number): PersonaValue[] {
  const rng = mulberry32(seed);
  resetValueIdCounter();
  return generateDecoysInternal(rng);
}

export { verifyVerhoeff, verifyLuhn, verifyGstin };

export function exportGroundTruth(seed: number, outDir: string = 'eval/fixtures'): void {
  const fs = require('fs');
  const path = require('path');
  const persona = generatePersona(seed);
  const allValues = [...persona.values, ...persona.decoys];
  const groundTruth = {
    seed,
    values: allValues.map(v => ({
      value: v.value,
      type: v.type,
      tier: v.tier,
      value_id: v.value_id,
      decoy: v.decoy || false,
    })),
    clinicalParagraph: persona.clinicalParagraph,
  };
  const outPath = path.join(outDir, `ground-truth-${seed}.json`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(groundTruth, null, 2));
}