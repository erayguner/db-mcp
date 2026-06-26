import { beforeEach } from '@jest/globals';
import { loadFeature, defineFeature } from 'jest-cucumber';
import { ColumnMaskingEngine, type ColumnMaskingRule } from '../../src/security/column-masking.js';
import { enforceKAnonymity, requiresDlp, type CohortRow } from '../../src/governance/dlp.js';
import type { DataClassification } from '../../src/governance/policy.js';

const feature = loadFeature('./pii-redaction.feature', { loadRelativePath: true });

function classificationFor(klass: string): DataClassification {
  return {
    $schema: 'db-mcp/data-classification.v1',
    version: '1.0.0',
    classifications: [{ dataset: 'ds', class: klass, piiFields: [], retentionDays: 30 }],
  } as DataClassification;
}

defineFeature(feature, (test) => {
  let engine: ColumnMaskingEngine;
  let masked: Record<string, unknown>;
  let lastValue: string;
  let cohorts: CohortRow[];

  beforeEach(() => {
    cohorts = [];
  });

  const givenMaskingRule = (given: (s: RegExp, fn: (...a: string[]) => void) => void) =>
    given(
      /^a masking engine that masks column "(.*)" as "(.*)" in dataset "(.*)" table "(.*)"$/,
      (column: string, maskType: string, dataset: string, table: string) => {
        const rule: ColumnMaskingRule = {
          datasetPattern: dataset,
          tablePattern: table,
          columnPattern: column,
          maskType: maskType as ColumnMaskingRule['maskType'],
        };
        engine = new ColumnMaskingEngine({
          enabled: true,
          defaultMaskType: 'redact',
          rules: [rule],
        });
      }
    );

  const whenMaskRow = (when: (s: RegExp, fn: (...a: string[]) => void) => void) =>
    when(
      /^a row with (\w+) "(.*)" is masked for dataset "(.*)" table "(.*)"$/,
      (field: string, value: string, dataset: string, table: string) => {
        lastValue = value;
        masked = engine.maskRow({ [field]: value }, dataset, table);
      }
    );

  test('Email values are partially masked', ({ given, when, then }) => {
    givenMaskingRule(given);
    whenMaskRow(when);
    then(/^the masked (\w+) is "(.*)"$/, (field, expected) => {
      expect(masked[field]).toBe(expected);
    });
  });

  test('Phone numbers keep only the last four digits', ({ given, when, then }) => {
    givenMaskingRule(given);
    whenMaskRow(when);
    then(/^the masked (\w+) is "(.*)"$/, (field, expected) => {
      expect(masked[field]).toBe(expected);
    });
  });

  test('Sensitive identifiers are hashed', ({ given, when, then }) => {
    givenMaskingRule(given);
    whenMaskRow(when);
    then(/^the masked (\w+) is a 64-character hex hash$/, (field) => {
      expect(String(masked[field])).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  test('Masking is a no-op when disabled', ({ given, when, then }) => {
    given('a masking engine that is disabled', () => {
      engine = new ColumnMaskingEngine({
        enabled: false,
        defaultMaskType: 'redact',
        rules: [{ datasetPattern: '*', tablePattern: '*', columnPattern: '*', maskType: 'redact' }],
      });
    });
    whenMaskRow(when);
    then(/^the (\w+) is returned unchanged$/, (field) => {
      expect(masked[field]).toBe(lastValue);
    });
  });

  test('A regulated dataset gets full DLP', ({ then }) => {
    then(/^DLP for a "(.*)" dataset is "(.*)"$/, (klass, expected) => {
      expect(requiresDlp(classificationFor(klass), 'ds')).toBe(expected);
    });
  });

  test('A confidential dataset is inspected', ({ then }) => {
    then(/^DLP for a "(.*)" dataset is "(.*)"$/, (klass, expected) => {
      expect(requiresDlp(classificationFor(klass), 'ds')).toBe(expected);
    });
  });

  test('A public dataset skips DLP', ({ then }) => {
    then(/^DLP for a "(.*)" dataset is "(.*)"$/, (klass, expected) => {
      expect(requiresDlp(classificationFor(klass), 'ds')).toBe(expected);
    });
  });

  test('k-anonymity suppresses cohorts below the threshold', ({ given, and, when, then }) => {
    given(/^a cohort "(.*)" with count (\d+)$/, (key, count) => {
      cohorts.push({ groupKey: key, count: Number(count) });
    });
    and(/^a cohort "(.*)" with count (\d+)$/, (key, count) => {
      cohorts.push({ groupKey: key, count: Number(count) });
    });
    let result: CohortRow[];
    when(/^k-anonymity with k (\d+) in suppress mode is enforced$/, (k) => {
      result = enforceKAnonymity(cohorts, Number(k), 'suppress');
    });
    then(/^only cohort "(.*)" remains$/, (key) => {
      expect(result.map((r) => r.groupKey)).toEqual([key]);
    });
  });

  test('k-anonymity rejects cohorts below the threshold in reject mode', ({ given, and, then }) => {
    given(/^a cohort "(.*)" with count (\d+)$/, (key, count) => {
      cohorts.push({ groupKey: key, count: Number(count) });
    });
    and(/^a cohort "(.*)" with count (\d+)$/, (key, count) => {
      cohorts.push({ groupKey: key, count: Number(count) });
    });
    then(/^enforcing k-anonymity with k (\d+) in reject mode throws$/, (k) => {
      expect(() => enforceKAnonymity(cohorts, Number(k), 'reject')).toThrow();
    });
  });
});
