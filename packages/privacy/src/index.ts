// C4, C6, C7, C8, C9 CONTRACTS: B's privacy functions
// A calls these from the orchestrator and executor
// This is the ONLY public surface — deep imports into packages/privacy are not supported

import type {
  RawObservation,
  CapturedFrame,
  SanitizedObservation,
  Handle,
  Budget,
} from '@glasswall/schema/observation';
import type {
  RedactionReason,
  AuditPrivacyFields,
  SanitizeResult,
  Detection,
  PolicyDecision,
  EgressCheck,
  Timings,
} from '@glasswall/schema/audit';
import type { PolicyConfig, PiiType } from '@glasswall/schema/policy';
import type { SafePayload, Violation, SecretRegistry, Sensitive, Result } from '@glasswall/schema/branded';

export {
  recognizeAll,
  recognizeEmail,
  recognizePhone,
  recognizeAadhaar,
  recognizePan,
  recognizeIfsc,
  recognizeGstin,
  recognizeUpi,
  recognizeCard,
  recognizeIp,
  recognizeDob,
  recognizeSecret,
  type RecognizerResult,
} from './recognizers';

export {
  normalize,
  encodeAllForms,
  SecretRegistry,
  type SecretRegistryEntry,
} from './registry';

export {
  tokenizeAndRegister,
  getHandleForValue,
  createTokenizer,
  type Tokenizer,
} from './tokenizer';

export { Vault, type VaultStore, type StorageAdapter } from './vault';
export { type Sensitive, createSensitive } from './sensitive';
export { VaultStoreImpl, InMemoryVaultStore, ChromeSessionVaultStore } from './vault-store';
export {
  resolveForBinding,
  extractPiiTypeFromHandle,
  type BindingTarget,
} from './resolve';

export { sanitize, type PerceptionSource, type PerceptionContext, type Evidence } from './sanitize';

export {
  checkVaultTypeMatch,
  scanLiteralAgainstRegistry,
  type Action,
} from './validator-hooks';

export {
  buildAuditPrivacyFields,
  assertNoValuesInAudit,
  createEgressChecks,
  type AuditPrivacyInput,
} from './audit';

export { egressGate } from './egress-gate';

export type {
  RawObservation,
  CapturedFrame,
  SanitizedObservation,
  Handle,
  Budget,
  RedactionReason,
  AuditPrivacyFields,
  SanitizeResult,
  Detection,
  PolicyDecision,
  EgressCheck,
  Timings,
  PolicyConfig,
  PiiType,
  SafePayload,
  Violation,
  SecretRegistry,
  Sensitive,
  Result,
};