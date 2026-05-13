import { describe, it, expect } from '@jest/globals';
import { readOnlyAnnotations, getToolAnnotations } from '../../../src/mcp/tools/annotations.js';

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
      costHintTier: 'low',
    });
  });

  it('catalog-only tools have openWorldHint set to false', () => {
    const tools = ['list_datasets', 'list_tables', 'get_table_schema'];
    for (const tool of tools) {
      expect(getToolAnnotations(tool).openWorldHint).toBe(false);
    }
  });

  it('query-execution tools have openWorldHint true (reach BigQuery)', () => {
    for (const tool of ['query_bigquery', 'execute_query']) {
      expect(getToolAnnotations(tool).openWorldHint).toBe(true);
    }
  });

  it('query-execution tools are tagged costHintTier=high', () => {
    for (const tool of ['query_bigquery', 'execute_query']) {
      expect(getToolAnnotations(tool).costHintTier).toBe('high');
    }
  });

  it('returns default annotations for unknown tools', () => {
    const annotations = getToolAnnotations('unknown_tool');
    expect(annotations.readOnlyHint).toBe(true);
    expect(annotations.openWorldHint).toBe(false);
  });
});
