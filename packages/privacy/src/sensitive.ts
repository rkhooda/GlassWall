export interface Sensitive<T> {
  __sensitiveBrand: '__sensitiveBrand';
  value: T;
}

export function isSensitive(value: unknown): value is Sensitive<unknown> {
  return value !== null && typeof value === 'object' && '__sensitiveBrand' in value && (value as Record<string, unknown>).__sensitiveBrand === '__sensitiveBrand';
}

export function createSensitive<T>(value: T): Sensitive<T> {
  const obj = Object.create(null);
  Object.defineProperty(obj, '__sensitiveBrand', {
    value: '__sensitiveBrand',
    writable: false,
    enumerable: false,
    configurable: false,
  });
  Object.defineProperty(obj, 'value', {
    value,
    writable: false,
    enumerable: false,
    configurable: false,
  });
  if (typeof Symbol !== 'undefined' && Symbol.for) {
    Object.defineProperty(obj, Symbol.for('nodejs.util.inspect.custom'), {
      value: () => '[redacted]',
      writable: false,
      enumerable: false,
      configurable: false,
    });
  }
  return obj as Sensitive<T>;
}

export function unwrapSensitive<T>(sensitive: Sensitive<T>): T {
  return sensitive.value;
}

export function sensitiveToString(): string {
  return '[redacted]';
}

export function sensitiveToJSON(): string {
  return '[redacted]';
}