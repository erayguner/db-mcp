import { describe, it, expect } from '@jest/globals';
import { CircuitBreaker, CircuitOpenError } from '../../src/governance/circuit-breaker';

const breaker = () =>
  new CircuitBreaker({
    name: 'test',
    failureThreshold: 2,
    halfOpenAfterMs: 50,
    successThreshold: 1,
  });

describe('CircuitBreaker', () => {
  it('passes through when closed', async () => {
    const b = breaker();
    expect(await b.execute(async () => 42)).toBe(42);
    expect(b.currentState).toBe('closed');
  });

  it('opens after consecutive failures and denies during cool-down', async () => {
    const b = breaker();
    for (let i = 0; i < 2; i++) {
      await expect(
        b.execute(async () => {
          throw new Error('x');
        })
      ).rejects.toThrow('x');
    }
    expect(b.currentState).toBe('open');
    await expect(b.execute(async () => 1)).rejects.toThrow(CircuitOpenError);
  });

  it('transitions half-open → closed on success', async () => {
    const b = breaker();
    for (let i = 0; i < 2; i++) {
      await expect(
        b.execute(async () => {
          throw new Error('x');
        })
      ).rejects.toThrow('x');
    }
    await new Promise((r) => setTimeout(r, 60));
    await b.execute(async () => 'ok');
    expect(b.currentState).toBe('closed');
  });

  it('re-opens on half-open failure', async () => {
    const b = breaker();
    for (let i = 0; i < 2; i++) {
      await expect(
        b.execute(async () => {
          throw new Error('x');
        })
      ).rejects.toThrow('x');
    }
    await new Promise((r) => setTimeout(r, 60));
    await expect(
      b.execute(async () => {
        throw new Error('y');
      })
    ).rejects.toThrow('y');
    expect(b.currentState).toBe('open');
  });

  it('honours callTimeoutMs', async () => {
    const b = new CircuitBreaker({
      name: 't',
      failureThreshold: 5,
      halfOpenAfterMs: 100,
      successThreshold: 1,
      callTimeoutMs: 20,
    });
    await expect(
      b.execute(() => new Promise((r) => setTimeout(() => r('late'), 100)))
    ).rejects.toThrow(/timeout/);
  });
});
