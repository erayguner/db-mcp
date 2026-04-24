import { TenantRegistry } from './tenant-registry.js';
import { TenantConfig } from './tenant-config.js';
import { DatasetPolicy } from './dataset-policy.js';
import { AuthenticatedPrincipal } from '../auth/oidc-authenticator.js';
import { logger } from '../utils/logger.js';

export interface TenantContext {
  tenantId: string;
  tenantName: string;
  projectId: string;
  principal: AuthenticatedPrincipal;
  policy: DatasetPolicy;
  config: TenantConfig;
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

    logger.info('Tenant context created', {
      tenantId: tenant.id,
      principal: principal.email,
      allowedDatasets: tenant.allowedDatasets,
      writeMode: tenant.writeMode,
    });

    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      projectId: tenant.projectId,
      principal,
      policy,
      config: tenant,
    };
  }
}
