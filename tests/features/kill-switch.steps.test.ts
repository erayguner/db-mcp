import { loadFeature, defineFeature } from 'jest-cucumber';
import { KillSwitch, SessionHaltedError } from '../../src/governance/kill-switch.js';

const feature = loadFeature('./kill-switch.feature', { loadRelativePath: true });

defineFeature(feature, (test) => {
  let ks: KillSwitch;

  const givenKillSwitch = (given: (s: string, fn: () => void) => void) =>
    given('a kill switch', () => {
      ks = new KillSwitch();
    });

  const haltStep = (register: (s: RegExp, fn: (...args: string[]) => void) => void) =>
    register(
      /^session "(.*)" is halted for reason "(.*)" by "(.*)"$/,
      (id: string, reason: string, actor: string) => {
        ks.halt(id, reason, actor);
      }
    );

  test('A halted session blocks further operations', ({ given, when, then, and }) => {
    givenKillSwitch(given);
    haltStep(when);
    then(/^session "(.*)" is reported as halted$/, (id) => {
      expect(ks.isHalted(id)).toBe(true);
    });
    and(/^enforcing session "(.*)" throws a session-halted error$/, (id) => {
      expect(() => ks.enforce(id)).toThrow(SessionHaltedError);
    });
  });

  test('A resumed session is allowed again', ({ given, and, when, then }) => {
    givenKillSwitch(given);
    haltStep(and);
    when(/^session "(.*)" is resumed by "(.*)"$/, (id, actor) => {
      ks.resume(id, actor);
    });
    then(/^session "(.*)" is not halted$/, (id) => {
      expect(ks.isHalted(id)).toBe(false);
    });
    and(/^enforcing session "(.*)" does not throw$/, (id) => {
      expect(() => ks.enforce(id)).not.toThrow();
    });
  });

  test('An unrelated session is never blocked', ({ given, and, then }) => {
    givenKillSwitch(given);
    haltStep(and);
    then(/^enforcing session "(.*)" does not throw$/, (id) => {
      expect(() => ks.enforce(id)).not.toThrow();
    });
  });

  test('The halt reason is recorded', ({ given, and, then }) => {
    givenKillSwitch(given);
    haltStep(and);
    then(/^the halt reason for session "(.*)" is "(.*)"$/, (id, reason) => {
      expect(ks.reason(id)).toBe(reason);
    });
  });
});
