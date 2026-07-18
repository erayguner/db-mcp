import { getToolAnnotations } from '../../../src/mcp/tools/annotations.js';
import { generateToolDefinitions } from '../../../src/mcp/tools/definitions.js';

/**
 * `readOnlyHint` drives auto-approval in MCP clients. The SQL tools accept
 * arbitrary statements, so when a tenant's writeMode permits DML/DDL they can
 * run DELETE or DROP TABLE. Advertising read-only in that case would let a
 * client silently auto-approve a destructive statement.
 */
describe('tool annotations reflect tenant write capability', () => {
  describe('read-only tenant (writeMode blocked)', () => {
    it('advertises the SQL tools as read-only and non-destructive', () => {
      for (const tool of ['query_bigquery', 'execute_query']) {
        const a = getToolAnnotations(tool, false);
        expect(a.readOnlyHint).toBe(true);
        expect(a.destructiveHint).toBe(false);
      }
    });
  });

  describe('write-enabled tenant', () => {
    it('stops claiming read-only and marks the SQL tools destructive', () => {
      for (const tool of ['query_bigquery', 'execute_query']) {
        const a = getToolAnnotations(tool, true);
        expect(a.readOnlyHint).toBe(false);
        expect(a.destructiveHint).toBe(true);
      }
    });

    it('leaves genuine metadata-only tools read-only', () => {
      for (const tool of ['list_datasets', 'list_tables', 'get_table_schema']) {
        const a = getToolAnnotations(tool, true);
        expect(a.readOnlyHint).toBe(true);
        expect(a.destructiveHint).toBe(false);
      }
    });
  });

  it('defaults to the safe read-only claim when write capability is unknown', () => {
    expect(getToolAnnotations('query_bigquery').readOnlyHint).toBe(true);
  });
});

describe('generateToolDefinitions', () => {
  const describeTool = (name: string) => `desc:${name}`;

  it('propagates write capability into the advertised annotations', () => {
    const readOnly = generateToolDefinitions(describeTool, false);
    const writable = generateToolDefinitions(describeTool, true);

    expect(readOnly.find((t) => t.name === 'query_bigquery')?.annotations?.readOnlyHint).toBe(true);
    expect(writable.find((t) => t.name === 'query_bigquery')?.annotations?.readOnlyHint).toBe(
      false
    );
    expect(writable.find((t) => t.name === 'query_bigquery')?.annotations?.destructiveHint).toBe(
      true
    );
  });

  it('gives every tool a description and an outputSchema', () => {
    for (const tool of generateToolDefinitions(describeTool)) {
      expect(tool.description).toBeTruthy();
      expect(tool.outputSchema).toBeDefined();
    }
  });

  it('uses the short annotation title as the display title, not the full description', () => {
    const tool = generateToolDefinitions(describeTool).find((t) => t.name === 'query_bigquery');
    expect(tool?.title).toBe('Run a BigQuery SQL query');
    expect(tool?.title).not.toBe(tool?.description);
  });
});
