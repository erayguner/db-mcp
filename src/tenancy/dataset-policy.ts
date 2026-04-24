import { TenantConfig, WriteMode } from './tenant-config.js';
import { logger } from '../utils/logger.js';

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

  extractDatasetReferences(query: string): string[] {
    const datasets = new Set<string>();
    // Match `project.dataset.table` backtick patterns
    const backtickPattern = /`(?:[\w-]+\.)?([\w-]+)\.[\w-]+`/g;
    let match: RegExpExecArray | null;
    while ((match = backtickPattern.exec(query)) !== null) {
      datasets.add(match[1]);
    }
    // Match unquoted FROM/JOIN/INTO references
    const unquotedPattern = /(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+(?:[\w-]+\.)?([\w-]+)\.[\w-]+/gi;
    while ((match = unquotedPattern.exec(query)) !== null) {
      datasets.add(match[1]);
    }
    return Array.from(datasets);
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
