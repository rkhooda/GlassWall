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
import type { SafePayload, Violation, Result } from '@glasswall/schema/branded';

export {
  recognizeAll,
  recognizeText,
  recognizeByContext,
  isLabelWord,
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
  generateEncodings,
  base64Utf8,
  SecretRegistry,
  type SecretEntry,
} from './registry';

export {
  tokenizeAndRegister,
  getHandleForValue,
  createTokenizer,
  type Tokenizer,
} from './tokenizer';

export { Vault, createVault, type VaultStore, type VaultEntry } from './vault';
export { type Sensitive, createSensitive } from './sensitive';
export {
  VaultStoreImpl,
  createChromeSessionVaultStore,
  createInMemoryVaultStore,
  createVaultStore,
  type StorageAdapter,
} from './vault-store';
export {
  resolveForBinding,
  extractPiiTypeFromHandle,
  isBindingAllowed,
  COMPATIBILITY_MATRIX,
  type BindingTarget,
} from './resolve';

export { SessionSecrets, createSessionSecrets, type SessionSecretsSnapshot } from './session-secrets';

export {
  sanitize,
  toPiiType,
  type SanitizeInput,
  type PerceptionSource,
  type PerceptionContext,
  type SourceOutput,
  type Evidence,
} from './sanitize';

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

export { egressGate, resetRateLimitForTests, lastGateTimings, type GatePolicy, type OutboundRequest } from './egress-gate';

export {
  PROFILES,
  DEFAULT_GATEWAY_ORIGIN,
  STRICT,
  BALANCED,
  PERMISSIVE,
  ProfileSchema,
  FusionConfigSchema,
  parseProfile,
  decide,
  tierForType,
  type Profile,
  type FusionConfig,
  type Decision,
  type Transformation,
  type EvidenceKind,
} from './policy';

export { fuse, noisyOr, type FusedRegion, type Rect4, type UnexplainedInput } from './fusion';

export {
  explainOrRedact,
  coverageFraction,
  partitionByExplanation,
  type CoverageResult,
} from './coverage';

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
  Result,
};