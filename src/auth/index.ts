/**
 * Enterprise Authentication & Authorization Module
 *
 * Comprehensive authentication system with:
 * - Workload Identity Federation
 * - Service Account Impersonation
 * - Credential Management
 * - Security Audit Logging
 * - Permission Validation
 * - Google Workspace Integration
 */

// Core Authentication
export { CredentialManager } from './credential-manager.js';
export type { CredentialConfig, TokenInfo, CredentialHealth } from './credential-manager.js';

export { WIFAuthenticator } from './wif-authenticator.js';
export type {
  WIFAuthConfig,
  WIFTokenExchangeResult,
  OIDCTokenClaims,
} from './wif-authenticator.js';

export { WorkloadIdentityFederation } from './workload-identity.js';
export type { WIFConfig } from './workload-identity.js';

export { GoogleWorkspaceAuth } from './google-workspace.js';
export type {
  GoogleWorkspaceConfig,
  WorkspaceUser,
} from './google-workspace.js';

// OIDC Authentication
export { OIDCAuthenticator, OIDCAuthenticationError } from './oidc-authenticator.js';
export type {
  OIDCConfig,
  AuthenticatedPrincipal,
} from './oidc-authenticator.js';

// Audit Logging
export {
  SecurityAuditLogger,
  getAuditLogger,
  AuditEventType,
  AuditSeverity,
} from './audit-logger.js';
export type {
  AuditEvent,
  AuditQueryOptions,
  AuditStatistics,
} from './audit-logger.js';

/**
 * Authentication Factory
 *
 * Simplified creation of authentication instances
 */

import { CredentialManager, CredentialConfig } from './credential-manager.js';
import { WIFAuthenticator, WIFAuthConfig } from './wif-authenticator.js';
import { GoogleWorkspaceAuth, GoogleWorkspaceConfig } from './google-workspace.js';
import { getAuditLogger } from './audit-logger.js';

export interface AuthenticationOptions {
  // Authentication method
  method: 'wif' | 'service_account' | 'oauth2' | 'compute';

  // WIF Configuration
  wif?: Partial<WIFAuthConfig>;

  // Credential Management
  credential?: Partial<CredentialConfig>;

  // Google Workspace
  workspace?: GoogleWorkspaceConfig;

  // Audit Logging
  enableAuditLogging?: boolean;
  auditRetentionDays?: number;
}

/**
 * Create enterprise authenticator
 */
export function createAuthenticator(options: AuthenticationOptions) {
  // Initialize audit logger (always enabled for security compliance)
  const auditLogger = getAuditLogger();

  // Create credential manager
  const credentialManager = new CredentialManager({
    authMethod: options.method,
    ...options.credential,
  });

  // Create WIF authenticator if using WIF
  let wifAuthenticator: WIFAuthenticator | undefined;
  if (options.method === 'wif' && options.wif) {
    wifAuthenticator = new WIFAuthenticator(options.wif);
  }

  // Create Workspace auth if configured
  let workspaceAuth: GoogleWorkspaceAuth | undefined;
  if (options.workspace) {
    workspaceAuth = new GoogleWorkspaceAuth(options.workspace);
  }

  return {
    credentialManager,
    wifAuthenticator,
    workspaceAuth,
    auditLogger,
  };
}

/**
 * Quick WIF setup
 */
export function createWIFAuthenticator(config: Partial<WIFAuthConfig>) {
  return new WIFAuthenticator(config);
}

/**
 * Quick Workspace auth setup
 */
export function createWorkspaceAuth(config: GoogleWorkspaceConfig) {
  return new GoogleWorkspaceAuth(config);
}

/**
 * Quick credential manager setup
 */
export function createCredentialManager(config: Partial<CredentialConfig>) {
  return new CredentialManager(config);
}
