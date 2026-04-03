import { readFile, watch } from 'fs';
import { TenantConfig, parseTenantConfig } from './tenant-config.js';
import { logger } from '../utils/logger.js';

export class TenantRegistry {
  private tenants: Map<string, TenantConfig> = new Map();
  private subjectPatterns: Map<string, RegExp> = new Map();
  private watcher?: ReturnType<typeof watch>;

  register(tenant: TenantConfig): void {
    this.tenants.set(tenant.id, tenant);
    if (tenant.oidcSubjectPattern) {
      this.subjectPatterns.set(tenant.id, new RegExp(tenant.oidcSubjectPattern));
    }
    logger.info('Tenant registered', {
      id: tenant.id,
      datasets: tenant.allowedDatasets,
      writeMode: tenant.writeMode,
    });
  }

  get(tenantId: string): TenantConfig | undefined {
    return this.tenants.get(tenantId);
  }

  resolveBySubject(subject: string): TenantConfig | undefined {
    for (const [tenantId, pattern] of this.subjectPatterns) {
      if (pattern.test(subject)) {
        return this.tenants.get(tenantId);
      }
    }
    return undefined;
  }

  list(): TenantConfig[] {
    return Array.from(this.tenants.values());
  }

  loadFromYaml(yamlContent: string): void {
    const config = parseTenantConfig(yamlContent);
    this.tenants.clear();
    this.subjectPatterns.clear();
    for (const tenant of config.tenants) {
      this.register(tenant);
    }
    logger.info('Tenant registry reloaded', { count: config.tenants.length });
  }

  loadFromFile(filePath: string): void {
    readFile(filePath, 'utf-8', (err, data) => {
      if (err) {
        logger.error('Failed to load tenant config', { filePath, error: err.message });
        return;
      }
      this.loadFromYaml(data);
    });
  }

  watchFile(filePath: string): void {
    this.watcher = watch(filePath, (eventType) => {
      if (eventType === 'change') {
        logger.info('Tenant config file changed, reloading', { filePath });
        this.loadFromFile(filePath);
      }
    });
    logger.info('Watching tenant config for changes', { filePath });
  }

  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
    }
  }

  size(): number {
    return this.tenants.size;
  }
}
