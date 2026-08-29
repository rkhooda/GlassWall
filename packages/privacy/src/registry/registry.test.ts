import { describe, it, expect, beforeEach } from 'vitest';
import { SecretRegistry } from './registry';

describe('SecretRegistry', () => {
  let registry: SecretRegistry;

  beforeEach(() => {
    registry = new SecretRegistry();
  });

  it('adds and retrieves secrets', () => {
    registry.add('sk_live_abcdefghijklmnopqrstuvwxyz', 'SECRET', 1);
    expect(registry.size()).toBe(1);
    expect(registry.has('sk_live_abcdefghijklmnopqrstuvwxyz')).toBe(true);
  });

  it('normalizes on add and lookup', () => {
    registry.add('sk_live_abcdefghijklmnopqrstuvwxyz', 'SECRET', 1);
    expect(registry.has('SK_LIVE_ABCDEFGHIJKLMNOPQRSTUVWXYZ')).toBe(true);
    expect(registry.has('sk_live_abcdefghijklmnopqrstuvwxyz')).toBe(true);
  });

  it('stores type and tier', () => {
    registry.add('sk_live_abcdefghijklmnopqrstuvwxyz', 'SECRET', 1);
    const entry = registry.get('sk_live_abcdefghijklmnopqrstuvwxyz');
    expect(entry!.type).toBe('SECRET');
    expect(entry!.tier).toBe(1);
  });

  it('generates encodings', () => {
    registry.add('test@example.com', 'EMAIL', 2);
    const entry = registry.get('test@example.com');
    expect(entry!.encodings.length).toBeGreaterThan(1);
    expect(entry!.encodings).toContain('test@example.com');
    expect(entry!.encodings).toContain('test%40example.com');
  });

  it('does not duplicate', () => {
    registry.add('sk_live_abcdefghijklmnopqrstuvwxyz', 'SECRET', 1);
    registry.add('sk_live_abcdefghijklmnopqrstuvwxyz', 'SECRET', 1);
    expect(registry.size()).toBe(1);
  });

  it('clears registry', () => {
    registry.add('secret1', 'SECRET', 1);
    registry.add('secret2', 'SECRET', 1);
    registry.clear();
    expect(registry.size()).toBe(0);
  });

  it('builds automaton on demand', () => {
    registry.add('sk_live_abcdefghijklmnopqrstuvwxyz', 'SECRET', 1);
    registry.add('pk_test_abcdefghijklmnopqrstuvwxyz', 'SECRET', 1);
    const automaton = registry.getAutomaton();
    expect(automaton).toBeDefined();
  });

  it('automaton finds secrets in text', () => {
    registry.add('sk_live_abcdefghijklmnopqrstuvwxyz', 'SECRET', 1);
    const automaton = registry.getAutomaton();
    const text = 'API key: sk_live_abcdefghijklmnopqrstuvwxyz for auth';
    const matches = automaton.search(text);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.some(m => m.pattern.includes('sk_live'))).toBe(true);
  });

  it('rebuilds automaton when new secrets added', () => {
    registry.add('secret1', 'SECRET', 1);
    const auto1 = registry.getAutomaton();
    registry.add('secret2', 'SECRET', 1);
    const auto2 = registry.getAutomaton();
    expect(auto2).not.toBe(auto1);
  });
});