import { describe, it, expect } from '@jest/globals';
import {
  BIGQUERY_RESOURCE_TEMPLATES,
  URI_MATCHERS,
  ALLOWED_INFORMATION_SCHEMA_VIEWS,
} from '../../../src/mcp/resources/templates.js';

describe('BigQuery resource templates', () => {
  it('exposes the expected RFC 6570 URI templates', () => {
    const uris = BIGQUERY_RESOURCE_TEMPLATES.map((t) => t.uriTemplate);
    expect(uris).toEqual(
      expect.arrayContaining([
        'bigquery://datasets/{datasetId}',
        'bigquery://datasets/{datasetId}/tables/{tableId}',
        'bigquery://datasets/{datasetId}/tables/{tableId}/schema',
        'bigquery://datasets/{datasetId}/tables/{tableId}/sample',
        'bigquery://jobs/{jobId}',
        'bigquery://datasets/{datasetId}/information_schema/{view}',
      ]),
    );
  });

  it('every template has name, description, and mimeType', () => {
    for (const t of BIGQUERY_RESOURCE_TEMPLATES) {
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.mimeType).toBe('application/json');
    }
  });

  describe('URI_MATCHERS', () => {
    it('matches schema URIs and captures datasetId/tableId', () => {
      const m = 'bigquery://datasets/sales/tables/orders/schema'.match(URI_MATCHERS.schema);
      expect(m).not.toBeNull();
      expect(m![1]).toBe('sales');
      expect(m![2]).toBe('orders');
    });

    it('matches sample URIs', () => {
      const m = 'bigquery://datasets/sales/tables/orders/sample'.match(URI_MATCHERS.sample);
      expect(m).not.toBeNull();
      expect(m![1]).toBe('sales');
      expect(m![2]).toBe('orders');
    });

    it('matches job URIs', () => {
      const m = 'bigquery://jobs/job-abc-123:US.foo'.match(URI_MATCHERS.job);
      expect(m).not.toBeNull();
      expect(m![1]).toBe('job-abc-123:US.foo');
    });

    it('matches INFORMATION_SCHEMA URIs', () => {
      const m = 'bigquery://datasets/sales/information_schema/TABLES'.match(URI_MATCHERS.informationSchema);
      expect(m).not.toBeNull();
      expect(m![1]).toBe('sales');
      expect(m![2]).toBe('TABLES');
    });

    it('does NOT match unrelated URIs', () => {
      expect('bigquery://datasets/sales'.match(URI_MATCHERS.schema)).toBeNull();
      expect('bigquery://datasets/sales/tables/orders'.match(URI_MATCHERS.sample)).toBeNull();
      expect('http://example.com'.match(URI_MATCHERS.job)).toBeNull();
    });
  });

  describe('ALLOWED_INFORMATION_SCHEMA_VIEWS', () => {
    it('includes the canonical catalog views', () => {
      for (const v of ['TABLES', 'COLUMNS', 'VIEWS', 'ROUTINES', 'PARTITIONS']) {
        expect(ALLOWED_INFORMATION_SCHEMA_VIEWS.has(v)).toBe(true);
      }
    });

    it('does NOT include arbitrary or injection-style names', () => {
      for (const v of ['DROP_TABLES', 'TABLES;--', 'tables', '']) {
        expect(ALLOWED_INFORMATION_SCHEMA_VIEWS.has(v)).toBe(false);
      }
    });
  });
});
