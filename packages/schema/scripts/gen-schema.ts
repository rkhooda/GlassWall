import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  RawObservationSchema,
  RawElementSchema,
  RawTextNodeSchema,
  CapturedFrameSchema,
  SanitizedObservationSchema,
  ObservedElementSchema,
  ActionSchema,
  ActionEnvelopeSchema,
  TargetSchema,
  ValueSchema,
  ActionResultSchema,
  PolicyConfigSchema,
  AuditRecordSchema,
  AuditPrivacyFieldsSchema,
  SafePayloadSchema,
  SessionRequestSchema,
  StepRequestSchema,
  StepResponseSchema,
  HealthResponseSchema,
} from '../src/index';

// Note: PiiTypeSchema is excluded from generation due to compatibility issues with zod-to-json-schema
// The type is still available in TypeScript and used in other schemas
const SCHEMAS = [
  { name: 'RawObservation', schema: RawObservationSchema },
  { name: 'RawElement', schema: RawElementSchema },
  { name: 'RawTextNode', schema: RawTextNodeSchema },
  { name: 'CapturedFrame', schema: CapturedFrameSchema },
  { name: 'SanitizedObservation', schema: SanitizedObservationSchema },
  { name: 'ObservedElement', schema: ObservedElementSchema },
  { name: 'Action', schema: ActionSchema },
  { name: 'ActionEnvelope', schema: ActionEnvelopeSchema },
  { name: 'Target', schema: TargetSchema },
  { name: 'Value', schema: ValueSchema },
  { name: 'ActionResult', schema: ActionResultSchema },
  { name: 'PolicyConfig', schema: PolicyConfigSchema },
  { name: 'AuditRecord', schema: AuditRecordSchema },
  { name: 'AuditPrivacyFields', schema: AuditPrivacyFieldsSchema },
  { name: 'SafePayload', schema: SafePayloadSchema },
  { name: 'SessionRequest', schema: SessionRequestSchema },
  { name: 'StepRequest', schema: StepRequestSchema },
  { name: 'StepResponse', schema: StepResponseSchema },
  { name: 'HealthResponse', schema: HealthResponseSchema },
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
