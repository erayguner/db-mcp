import { describe, it, expect } from '@jest/globals';
import {
  readOnlyAnnotations,
  destructiveAnnotations,
  getToolAnnotations,
} from '../../../src/mcp/tools/annotations.js';

describe('Tool Annotations', () => {
  it('returns read-only annotations for query_bigquery', () => {
    const annotations = getToolAnnotations('query_bigquery');
    expect(annotations.readOnlyHint).toBe(true);
    expect(annotations.destructiveHint).toBe(false);
  });

  it('returns read-only annotations for list_datasets', () => {
    const annotations = getToolAnnotations('list_datasets');
    expect(annotations.readOnlyHint).toBe(true);
  });

  it('returns read-only annotations for list_tables', () => {
    const annotations = getToolAnnotations('list_tables');
    expect(annotations.readOnlyHint).toBe(true);
  });

  it('returns read-only annotations for get_table_schema', () => {
    const annotations = getToolAnnotations('get_table_schema');
    expect(annotations.readOnlyHint).toBe(true);
    expect(annotations.idempotentHint).toBe(true);
  });

  it('readOnlyAnnotations helper returns correct shape', () => {
    const ann = readOnlyAnnotations();
    expect(ann).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it('destructiveAnnotations helper returns correct shape', () => {
    const ann = destructiveAnnotations();
    expect(ann).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });
  });
});
