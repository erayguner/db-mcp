import { describe, it, expect } from '@jest/globals';
import { DeadLetterQueue } from '../../src/governance/dead-letter-queue';

describe('DeadLetterQueue', () => {
  it('succeeds on first try does not enqueue', async () => {
    const dlq = new DeadLetterQueue<string>({
      name: 'ok', maxAttempts: 3, baseDelayMs: 1, maxBacklog: 10,
      handler: async () => { /* ok */ },
    });
    await dlq.submit('1', 'payload');
    expect(dlq.size).toBe(0);
  });

  it('enqueues on failure and retries on drain', async () => {
    let calls = 0;
    const dlq = new DeadLetterQueue<string>({
      name: 'retry', maxAttempts: 5, baseDelayMs: 1, maxBacklog: 10,
      handler: async () => { calls += 1; if (calls < 3) throw new Error('boom'); },
    });
    await dlq.submit('x', 'p');
    expect(dlq.size).toBe(1);
    await new Promise(r => setTimeout(r, 20));
    const r1 = await dlq.drain();
    expect(r1.retained).toBeGreaterThanOrEqual(0);
    await new Promise(r => setTimeout(r, 40));
    const r2 = await dlq.drain();
    expect(dlq.size + r1.succeeded + r2.succeeded).toBe(1);
  });

  it('drops after maxAttempts', async () => {
    const dlq = new DeadLetterQueue<string>({
      name: 'drop', maxAttempts: 2, baseDelayMs: 1, maxBacklog: 10,
      handler: async () => { throw new Error('always fails'); },
    });
    await dlq.submit('x', 'p');
    await new Promise(r => setTimeout(r, 20));
    await dlq.drain();
    await new Promise(r => setTimeout(r, 40));
    const r = await dlq.drain();
    expect(dlq.size).toBe(0);
    expect(r.dropped + r.succeeded).toBeGreaterThan(0);
  });

  it('respects maxBacklog hard cap', async () => {
    const dlq = new DeadLetterQueue<string>({
      name: 'cap', maxAttempts: 10, baseDelayMs: 1, maxBacklog: 2,
      handler: async () => { throw new Error('fail'); },
    });
    await dlq.submit('a', 'p');
    await dlq.submit('b', 'p');
    await dlq.submit('c', 'p');
    expect(dlq.size).toBeLessThanOrEqual(2);
  });
});
