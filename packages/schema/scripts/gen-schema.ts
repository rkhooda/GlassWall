import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  RawObservationSchema,
  RawElementSchema,
  RawTextNodeSchema,
  CapturedFrameSchema,
  ActionSchema,
  ActionEnvelopeSchema,
  ActionResultSchema,
  PolicyConfigSchema,
  AuditRecordSchema,
  AuditPrivacyFieldsSchema,
} from '../src/index';

const SCHEMAS = [
  { name: 'RawObservation', schema: RawObservationSchema },
  { name: 'RawElement', schema: RawElementSchema },
  { name: 'RawTextNode', schema: RawTextNodeSchema },
  { name: 'CapturedFrame', schema: CapturedFrameSchema },
  { name: 'Action', schema: ActionSchema },
  { name: 'ActionEnvelope', schema: ActionEnvelopeSchema },
  { name: 'ActionResult', schema: ActionResultSchema },
  { name: 'PolicyConfig', schema: PolicyConfigSchema },
  { name: 'AuditRecord', schema: AuditRecordSchema },
  { name: 'AuditPrivacyFields', schema: AuditPrivacyFieldsSchema },
];

function main() {
  const outDir = resolve(__dirname, '../generated');
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  for (const { name, schema } of SCHEMAS) {
    const jsonSchema = zodToJsonSchema(schema, {
      name,
      $refStrategy: 'none',
      additionalProperties: false,
      strictUnions: true,
    });

    writeFileSync(resolve(outDir, `${name}.json`), JSON.stringify(jsonSchema, null, 2));
    console.log(`Generated ${name}.json`);
  }

  const combined = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    definitions: Object.fromEntries(
      SCHEMAS.map(({ name, schema }) => [
        name,
        zodToJsonSchema(schema, { $refStrategy: 'none', additionalProperties: false }),
      ])
    ),
  };

  writeFileSync(resolve(outDir, 'combined.json'), JSON.stringify(combined, null, 2));
  console.log('Generated combined.json');
}

main();
