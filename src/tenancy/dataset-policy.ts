import { TenantConfig, WriteMode } from './tenant-config.js';
import { logger } from '../utils/logger.js';

export interface TableReference {
  datasetId: string;
  tableId: string;
}

export interface QueryValidationResult {
  allowed: boolean;
  reason?: string;
  datasetsAccessed: string[];
  isWrite: boolean;
}

export class DatasetPolicy {
  private tenant: TenantConfig;
  private allowedSet: Set<string>;
  private deniedSet: Set<string>;
  private allowAll: boolean;

  constructor(tenant: TenantConfig) {
    this.tenant = tenant;
    this.allowedSet = new Set(tenant.allowedDatasets);
    this.deniedSet = new Set(tenant.deniedDatasets);
    this.allowAll = this.allowedSet.has('*');
  }

  canAccessDataset(datasetId: string): boolean {
    if (this.deniedSet.has(datasetId)) return false;
    if (this.allowAll) return true;
    return this.allowedSet.has(datasetId);
  }

  canWrite(): boolean {
    return (
      this.tenant.writeMode === WriteMode.ALLOWED || this.tenant.writeMode === WriteMode.PROTECTED
    );
  }

  isDMLQuery(query: string): boolean {
    return /^\s*(INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|MERGE\s+INTO)\b/i.test(query.trim());
  }

  isDDLQuery(query: string): boolean {
    return /^\s*(CREATE\s+|DROP\s+|ALTER\s+|TRUNCATE\s+)\b/i.test(query.trim());
  }

  /**
   * Extract `dataset.table` pairs referenced by a query.
   *
   * Used both for dataset authorization and for resolving which column-masking
   * rules apply to a result set. Recognises backtick-qualified references
   * (`project.dataset.table`) and unquoted FROM/JOIN/INTO/UPDATE/TABLE clauses.
   *
   * This is a lexical scan, not a SQL parser: it cannot resolve CTEs, aliases or
   * dynamic SQL. Callers applying security controls must treat the result as a
   * superset hint and fail safe (over-apply) rather than assume completeness.
   */
  extractTableReferences(query: string): TableReference[] {
    const refs = new Map<string, TableReference>();
    const patterns = [
      // `project.dataset.table` / `dataset.table`
      /`(?:[\w-]+\.)?([\w-]+)\.([\w-]+)`/g,
      // FROM|JOIN|INTO|UPDATE|TABLE project.dataset.table
      /(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+(?:[\w-]+\.)?([\w-]+)\.([\w-]+)/gi,
    ];

    for (const pattern of patterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(query)) !== null) {
        const ref = { datasetId: match[1], tableId: match[2] };
        refs.set(`${ref.datasetId}.${ref.tableId}`, ref);
      }
    }

    return Array.from(refs.values());
  }

  extractDatasetReferences(query: string): string[] {
    return Array.from(new Set(this.extractTableReferences(query).map((r) => r.datasetId)));
  }

  validateQuery(query: string): QueryValidationResult {
    const isWrite = this.isDMLQuery(query) || this.isDDLQuery(query);
    const datasetsAccessed = this.extractDatasetReferences(query);

    if (isWrite && !this.canWrite()) {
      logger.warn('Write query blocked by tenant policy', {
        tenant: this.tenant.id,
        writeMode: this.tenant.writeMode,
      });
      return {
        allowed: false,
        reason: `Tenant "${this.tenant.id}" does not allow write operations (writeMode: ${this.tenant.writeMode})`,
        datasetsAccessed,
        isWrite,
      };
    }

    const unauthorized = datasetsAccessed.filter((ds) => !this.canAccessDataset(ds));
    if (unauthorized.length > 0) {
      logger.warn('Dataset access denied by tenant policy', {
        tenant: this.tenant.id,
        unauthorized,
      });
      return {
        allowed: false,
        reason: `Tenant "${this.tenant.id}" is not authorized to access datasets: ${unauthorized.join(', ')}`,
        datasetsAccessed,
        isWrite,
      };
    }

    return { allowed: true, datasetsAccessed, isWrite };
  }

  getMaxBytesBilled(): string | undefined {
    return this.tenant.maxBytesPerQuery;
  }

  getTenantId(): string {
    return this.tenant.id;
  }

  getProjectId(): string {
    return this.tenant.projectId;
  }
}
