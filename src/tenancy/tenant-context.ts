import { TenantRegistry } from './tenant-registry.js';
import { TenantConfig } from './tenant-config.js';
import { DatasetPolicy } from './dataset-policy.js';
import { ColumnMaskingEngine } from '../security/column-masking.js';
import { AuthenticatedPrincipal } from '../auth/oidc-authenticator.js';
import { logger } from '../utils/logger.js';

export interface TenantContext {
  tenantId: string;
  tenantName: string;
  projectId: string;
  principal: AuthenticatedPrincipal;
  policy: DatasetPolicy;
  config: TenantConfig;
  /**
   * Column-masking engine built from this tenant's `columnMasking` config.
   * Always present; it is a no-op passthrough when masking is disabled.
   */
  masking: ColumnMaskingEngine;
}

export class TenantResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantResolutionError';
  }
}

export class TenantContextFactory {
  constructor(
    private registry: TenantRegistry,
    private defaultTenantId: string
  ) {}

  createContext(principal: AuthenticatedPrincipal): TenantContext {
    let tenant =
      this.registry.resolveBySubject(principal.email) ||
      this.registry.resolveBySubject(principal.subject);

    if (!tenant) {
      tenant = this.registry.get(this.defaultTenantId);
    }

    if (!tenant) {
      throw new TenantResolutionError(
        `No tenant found for principal "${principal.email}" and no default tenant configured`
      );
    }

    const policy = new DatasetPolicy(tenant);
    // `columnMasking` carries a Zod default, but TenantConfig values can reach us
    // without having gone through the schema. Treat a missing block as "no rules"
    // rather than throwing, which would fail tenant resolution outright.
    const maskingConfig = tenant.columnMasking ?? { enabled: false, rules: [] };
    const masking = new ColumnMaskingEngine({
      enabled: maskingConfig.enabled,
      rules: maskingConfig.rules,
      defaultMaskType: 'redact',
    });

    logger.info('Tenant context created', {
      tenantId: tenant.id,
      principal: principal.email,
      allowedDatasets: tenant.allowedDatasets,
      writeMode: tenant.writeMode,
      maskingEnabled: maskingConfig.enabled,
      maskingRuleCount: maskingConfig.rules.length,
    });

    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      projectId: tenant.projectId,
      principal,
      policy,
      config: tenant,
      masking,
    };
  }
}
