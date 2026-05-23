import { describe, it, expect } from '@jest/globals';
import { KillSwitch, SessionHaltedError } from '../../src/governance/kill-switch';

describe('KillSwitch', () => {
  it('halts and enforces on the session', () => {
    const ks = new KillSwitch();
    ks.halt('sess-1', 'suspicious tool-chain', 'ops@example.com');
    expect(ks.isHalted('sess-1')).toBe(true);
    expect(() => ks.enforce('sess-1')).toThrow(SessionHaltedError);
  });

  it('resume releases the halt', () => {
    const ks = new KillSwitch();
    ks.halt('s', 'r', 'a');
    ks.resume('s', 'a');
    expect(ks.isHalted('s')).toBe(false);
    expect(() => ks.enforce('s')).not.toThrow();
  });

  it('emits hook events', () => {
    let halted = 0,
      resumed = 0;
    const ks = new KillSwitch({ onHalt: () => halted++, onResume: () => resumed++ });
    ks.halt('s', 'r', 'a');
    ks.resume('s', 'a');
    expect(halted).toBe(1);
    expect(resumed).toBe(1);
  });
});
