import { z } from 'zod';
import {
  QueryBigQueryArgsSchema,
  ListDatasetsArgsSchema,
  ListTablesArgsSchema,
  GetTableSchemaArgsSchema,
  TOOL_SCHEMAS,
  validateToolArgs,
  getToolInputSchema,
} from '../../../src/mcp/schemas/tool-schemas.js';

describe('Tool Validation Schemas', () => {
  describe('QueryBigQueryArgsSchema', () => {
    it('should validate valid query arguments', () => {
      const valid = {
        query: 'SELECT * FROM table',
        dryRun: false,
        maxResults: 1000,
        timeoutMs: 30000,
        useLegacySql: false,
        location: 'EU',
      };

      const result = QueryBigQueryArgsSchema.parse(valid);
      expect(result).toEqual({ ...valid, confirmCost: false });
    });

    it('should apply default values', () => {
      const minimal = {
        query: 'SELECT 1',
      };

      const result = QueryBigQueryArgsSchema.parse(minimal);
      expect(result.dryRun).toBe(false);
      expect(result.useLegacySql).toBe(false);
    });

    it('should reject empty query', () => {
      expect(() => {
        QueryBigQueryArgsSchema.parse({ query: '' });
      }).toThrow();
    });

    it('should reject whitespace-only query', () => {
      expect(() => {
        QueryBigQueryArgsSchema.parse({ query: '   ' });
      }).toThrow();
    });

    it('should reject query exceeding max length', () => {
      const longQuery = 'SELECT '.repeat(200000); // > 1MB

      expect(() => {
        QueryBigQueryArgsSchema.parse({ query: longQuery });
      }).toThrow();
    });

    it('should reject invalid maxResults', () => {
      const invalid = [
        { query: 'SELECT 1', maxResults: 0 },
        { query: 'SELECT 1', maxResults: -100 },
        { query: 'SELECT 1', maxResults: 200000 },
        { query: 'SELECT 1', maxResults: 1.5 },
      ];

      invalid.forEach((args) => {
        expect(() => QueryBigQueryArgsSchema.parse(args)).toThrow();
      });
    });

    it('should reject invalid timeoutMs', () => {
      const invalid = [
        { query: 'SELECT 1', timeoutMs: 0 },
        { query: 'SELECT 1', timeoutMs: -1000 },
        { query: 'SELECT 1', timeoutMs: 700000 },
      ];

      invalid.forEach((args) => {
        expect(() => QueryBigQueryArgsSchema.parse(args)).toThrow();
      });
    });

    it('should accept optional fields', () => {
      const result = QueryBigQueryArgsSchema.parse({
        query: 'SELECT 1',
      });

      expect(result.maxResults).toBeUndefined();
      expect(result.timeoutMs).toBeUndefined();
      expect(result.location).toBeUndefined();
    });
  });

  describe('ListDatasetsArgsSchema', () => {
    it('should validate valid arguments', () => {
      const valid = {
        projectId: 'my-project',
        maxResults: 100,
        includeAll: true,
      };

      const result = ListDatasetsArgsSchema.parse(valid);
      expect(result).toEqual(valid);
    });

    it('should allow empty arguments', () => {
      const result = ListDatasetsArgsSchema.parse({});

      expect(result.projectId).toBeUndefined();
      expect(result.includeAll).toBe(false);
    });

    it('should reject invalid maxResults', () => {
      const invalid = [{ maxResults: 0 }, { maxResults: -10 }, { maxResults: 15000 }];

      invalid.forEach((args) => {
        expect(() => ListDatasetsArgsSchema.parse(args)).toThrow();
      });
    });
  });

  describe('ListTablesArgsSchema', () => {
    it('should validate valid arguments', () => {
      const valid = {
        datasetId: 'my_dataset',
        projectId: 'my-project',
        maxResults: 500,
      };

      const result = ListTablesArgsSchema.parse(valid);
      expect(result).toEqual(valid);
    });

    it('should reject empty datasetId', () => {
      expect(() => {
        ListTablesArgsSchema.parse({ datasetId: '' });
      }).toThrow();
    });

    it('should reject invalid datasetId characters', () => {
      const invalid = [
        { datasetId: 'my-dataset' }, // hyphen not allowed
        { datasetId: 'my.dataset' }, // dot not allowed
        { datasetId: 'my dataset' }, // space not allowed
        { datasetId: 'my@dataset' }, // special char not allowed
      ];

      invalid.forEach((args) => {
        expect(() => ListTablesArgsSchema.parse(args)).toThrow();
      });
    });

    it('should accept valid datasetId patterns', () => {
      const valid = [
        { datasetId: 'dataset123' },
        { datasetId: 'my_dataset' },
        { datasetId: 'Dataset_123' },
        { datasetId: '_private_dataset' },
      ];

      valid.forEach((args) => {
        expect(() => ListTablesArgsSchema.parse(args)).not.toThrow();
      });
    });
  });

  describe('GetTableSchemaArgsSchema', () => {
    it('should validate valid arguments', () => {
      const valid = {
        datasetId: 'my_dataset',
        tableId: 'my_table',
        projectId: 'my-project',
        includeMetadata: true,
      };

      const result = GetTableSchemaArgsSchema.parse(valid);
      expect(result).toEqual(valid);
    });

    it('should apply default for includeMetadata', () => {
      const result = GetTableSchemaArgsSchema.parse({
        datasetId: 'dataset',
        tableId: 'table',
      });

      expect(result.includeMetadata).toBe(true);
    });

    it('should reject invalid tableId', () => {
      const invalid = [
        { datasetId: 'dataset', tableId: '' },
        { datasetId: 'dataset', tableId: 'table-name' },
        { datasetId: 'dataset', tableId: 'table.name' },
      ];

      invalid.forEach((args) => {
        expect(() => GetTableSchemaArgsSchema.parse(args)).toThrow();
      });
    });

    it('should require both datasetId and tableId', () => {
      expect(() => {
        GetTableSchemaArgsSchema.parse({ datasetId: 'dataset' });
      }).toThrow();

      expect(() => {
        GetTableSchemaArgsSchema.parse({ tableId: 'table' });
      }).toThrow();
    });
  });

  describe('validateToolArgs', () => {
    it('should validate and return typed arguments', () => {
      const args = {
        query: 'SELECT * FROM users',
        maxResults: 100,
      };

      const result = validateToolArgs('query_bigquery', args);

      expect(result.query).toBe('SELECT * FROM users');
      expect(result.maxResults).toBe(100);
      expect(result.dryRun).toBe(false); // Default value
    });

    it('should throw error for unknown tool', () => {
      expect(() => {
        validateToolArgs('unknown_tool' as any, {});
      }).toThrow('Unknown tool: unknown_tool');
    });

    it('should throw detailed validation error', () => {
      const invalidArgs = {
        query: '', // Invalid - empty
        maxResults: -10, // Invalid - negative
      };

      try {
        validateToolArgs('query_bigquery', invalidArgs);
        fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('Validation failed');
        expect((error as Error).message).toContain('query_bigquery');
      }
    });

    it('should provide structured error information', () => {
      const invalidArgs = {
        datasetId: 'invalid-name', // Contains hyphen
      };

      try {
        validateToolArgs('list_tables', invalidArgs);
        fail('Should have thrown error');
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toContain('path');
        expect(message).toContain('message');
        expect(message).toContain('code');
      }
    });

    it('should validate all tool types correctly', () => {
      const toolTests = [
        {
          tool: 'query_bigquery' as const,
          args: { query: 'SELECT 1' },
        },
        {
          tool: 'list_datasets' as const,
          args: {},
        },
        {
          tool: 'list_tables' as const,
          args: { datasetId: 'dataset' },
        },
        {
          tool: 'get_table_schema' as const,
          args: { datasetId: 'dataset', tableId: 'table' },
        },
      ];

      toolTests.forEach(({ tool, args }) => {
        expect(() => validateToolArgs(tool, args)).not.toThrow();
      });
    });
  });

  describe('getToolInputSchema', () => {
    it('should return JSON schema for tool', () => {
      const schema = getToolInputSchema('query_bigquery');

      expect(schema).toHaveProperty('type', 'object');
      expect(schema).toHaveProperty('properties');
      expect(schema).toHaveProperty('required');
    });

    it('should include all properties', () => {
      const schema = getToolInputSchema('query_bigquery');

      expect(schema.properties).toHaveProperty('query');
      expect(schema.properties).toHaveProperty('dryRun');
      expect(schema.properties).toHaveProperty('maxResults');
      expect(schema.properties).toHaveProperty('timeoutMs');
      expect(schema.properties).toHaveProperty('useLegacySql');
      expect(schema.properties).toHaveProperty('location');
    });

    it('should mark required fields correctly', () => {
      const querySchema = getToolInputSchema('query_bigquery');
      const tableSchema = getToolInputSchema('get_table_schema');

      expect(querySchema.required).toContain('query');
      expect(tableSchema.required).toContain('datasetId');
      expect(tableSchema.required).toContain('tableId');
    });

    it('should throw error for unknown tool', () => {
      expect(() => {
        getToolInputSchema('invalid_tool' as any);
      }).toThrow('Unknown tool: invalid_tool');
    });

    it('should work for all registered tools', () => {
      const toolNames = Object.keys(TOOL_SCHEMAS) as Array<keyof typeof TOOL_SCHEMAS>;

      toolNames.forEach((toolName) => {
        expect(() => getToolInputSchema(toolName)).not.toThrow();
      });
    });
  });

  describe('TOOL_SCHEMAS constant', () => {
    it('should contain all expected tools', () => {
      const expectedTools = [
        'query_bigquery',
        'execute_query',
        'list_datasets',
        'list_tables',
        'get_table_schema',
      ];

      expectedTools.forEach((tool) => {
        expect(TOOL_SCHEMAS).toHaveProperty(tool);
      });
    });

    it('should have Zod schemas as values', () => {
      Object.values(TOOL_SCHEMAS).forEach((schema) => {
        expect(schema).toBeInstanceOf(z.ZodObject);
      });
    });
  });

  describe('Edge Cases and Security', () => {
    it('should prevent SQL injection patterns in validation', () => {
      // Note: Validation layer only checks structure, not content
      // Security middleware handles SQL injection detection
      const suspiciousQuery = 'SELECT * FROM users; DROP TABLE users;--';

      // Schema validation allows this (it's a valid string)
      expect(() => QueryBigQueryArgsSchema.parse({ query: suspiciousQuery })).not.toThrow();

      // But security middleware would catch it
    });

    it('should handle very long dataset/table names', () => {
      const longName = 'a'.repeat(200);

      expect(() => ListTablesArgsSchema.parse({ datasetId: longName })).not.toThrow(); // Schema doesn't enforce length limit

      // Length validation happens in security middleware
    });

    it('should handle unicode characters appropriately', () => {
      const unicodeName = 'dataset_测试';

      // Should fail regex validation (non-ASCII)
      expect(() => ListTablesArgsSchema.parse({ datasetId: unicodeName })).toThrow();
    });

    it('should handle null and undefined correctly', () => {
      expect(() => QueryBigQueryArgsSchema.parse({ query: null })).toThrow();

      expect(() => QueryBigQueryArgsSchema.parse({ query: undefined })).toThrow();
    });

    it('should handle extra fields gracefully', () => {
      const argsWithExtra = {
        query: 'SELECT 1',
        extraField: 'should be ignored',
        anotherExtra: 123,
      };

      // Zod strips extra fields by default
      const result = QueryBigQueryArgsSchema.parse(argsWithExtra);

      expect(result).toHaveProperty('query');
      expect(result).not.toHaveProperty('extraField');
      expect(result).not.toHaveProperty('anotherExtra');
    });
  });
});
