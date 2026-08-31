import { Page } from '@playwright/test';
import { generatePersona, type Persona } from '../../apps/bench-site/src/data/generator';

export interface SyntheticSecrets {
  email: string;
  phone: string;
  aadhaar: string;
  pan: string;
  creditCard: string;
  apiKey: string;
}

export interface InjectedLocations {
  visibleText: string;
  formValue: string;
  canvasText: string;
  imageText: string;
  hiddenAttribute: string;
}

function generateSecrets(seed: number): SyntheticSecrets {
  const persona = generatePersona(seed);
  return {
    email: persona.email,
    phone: persona.phone,
    aadhaar: persona.aadhaar,
    pan: persona.pan,
    creditCard: persona.creditCard,
    apiKey: `sk_test_${persona.secret.slice(0, 24)}`,
  };
}

export async function injectSyntheticSecrets(
  page: Page,
  seed: number
): Promise<{ secrets: SyntheticSecrets; locations: InjectedLocations }> {
  const secrets = generateSecrets(seed);

  await page.evaluate((secrets) => {
    const container = document.createElement('div');
    container.id = 'glasswall-secrets';
    container.style.display = 'none';
    document.body.appendChild(container);
  });

  await page.evaluate((secrets) => {
    const el = document.createElement('span');
    el.id = 'gw-visible-text';
    el.textContent = `Contact: ${secrets.email} or call ${secrets.phone}`;
    document.body.appendChild(el);
  }, secrets);

  await page.evaluate((secrets) => {
    const input = document.createElement('input');
    input.id = 'gw-form-value';
    input.type = 'hidden';
    input.value = `${secrets.aadhaar},${secrets.pan},${secrets.creditCard}`;
    document.body.appendChild(input);
  }, secrets);

  await page.evaluate((secrets) => {
    const canvas = document.createElement('canvas');
    canvas.id = 'gw-canvas';
    canvas.width = 400;
    canvas.height = 100;
    const ctx = canvas.getContext('2d')!;
    ctx.font = '16px Arial';
    ctx.fillStyle = 'black';
    ctx.fillText(`Aadhaar: ${secrets.aadhaar}`, 10, 30);
    ctx.fillText(`API Key: ${secrets.apiKey}`, 10, 60);
    document.body.appendChild(canvas);
  }, secrets);

  await page.evaluate((secrets) => {
    const img = document.createElement('img');
    img.id = 'gw-image';
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 80;
    const ctx = canvas.getContext('2d')!;
    ctx.font = '14px Arial';
    ctx.fillStyle = 'black';
    ctx.fillText(`PAN: ${secrets.pan}`, 10, 25);
    ctx.fillText(`Email: ${secrets.email}`, 10, 50);
    img.src = canvas.toDataURL('image/png');
    img.style.display = 'none';
    document.body.appendChild(img);
  }, secrets);

  await page.evaluate((secrets) => {
    const meta = document.createElement('meta');
    meta.id = 'gw-hidden-attr';
    meta.name = 'glasswall-secrets';
    meta.content = `${secrets.email}|${secrets.apiKey}`;
    document.head.appendChild(meta);
    document.title = `Page - ${secrets.phone}`;
  }, secrets);

  const locations: InjectedLocations = {
    visibleText: `Contact: ${secrets.email} or call ${secrets.phone}`,
    formValue: `${secrets.aadhaar},${secrets.pan},${secrets.creditCard}`,
    canvasText: `Aadhaar: ${secrets.aadhaar}\nAPI Key: ${secrets.apiKey}`,
    imageText: `PAN: ${secrets.pan}\nEmail: ${secrets.email}`,
    hiddenAttribute: `${secrets.email}|${secrets.apiKey}`,
  };

  return { secrets, locations };
}

export async function verifySecretsInjected(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const visible = document.getElementById('gw-visible-text')?.textContent || '';
    const form = (document.getElementById('gw-form-value') as HTMLInputElement)?.value || '';
    const canvas = document.getElementById('gw-canvas') as HTMLCanvasElement;
    const img = document.getElementById('gw-image') as HTMLImageElement;
    const meta = document.getElementById('gw-hidden-attr') as HTMLMetaElement;
    const title = document.title;

    return !!(visible && form && canvas && img && meta && title.includes('Page -'));
  });
}