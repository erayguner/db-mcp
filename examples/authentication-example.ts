/**
 * Enterprise Authentication Example
 *
 * Demonstrates complete authentication flow with:
 * - WIF authentication
 * - Service account impersonation
 * - Permission validation
 * - Audit logging
 * - Token management
 */

import {
  createWIFAuthenticator,
  createCredentialManager,
  getAuditLogger,
  AuditEventType,
} from '../src/auth/index.js';
import { PermissionValidator } from '../src/security/permission-validator.js';
import { logger } from '../src/utils/logger.js';

// ==========================================
// Configuration
// ==========================================

interface AuthConfig {
  projectId: string;
  poolId: string;
  providerId: string;
  serviceAccountEmail: string;
  oidcToken: string;
}

// ==========================================
// Example 1: Basic WIF Authentication
// ==========================================

export async function basicWIFAuth(config: AuthConfig) {
  console.log('\n=== Example 1: Basic WIF Authentication ===\n');

  // Create WIF authenticator
  const wifAuth = createWIFAuthenticator({
    projectId: config.projectId,
    workloadIdentityPoolId: config.poolId,
    workloadIdentityProviderId: config.providerId,
    serviceAccountEmail: config.serviceAccountEmail,
    enableAuditLogging: true,
  });

  try {
    // Authenticate with external OIDC token
    const result = await wifAuth.authenticate(config.oidcToken);

    console.log('✅ Authentication successful!');
    console.log('   Principal:', result.principal);
    console.log('   Expires in:', result.expiresIn, 'seconds');
    console.log('   Token type:', result.tokenType);

    // Validate authentication
    const isValid = await wifAuth.validateAuthentication();
    console.log('   Authentication valid:', isValid);

    return result;
  } catch (error) {
    console.error('❌ Authentication failed:', error);
    throw error;
  }
}

// ==========================================
// Example 2: Service Account Impersonation
// ==========================================

export async function serviceAccountImpersonation(config: AuthConfig) {
  console.log('\n=== Example 2: Service Account Impersonation ===\n');

  const wifAuth = createWIFAuthenticator({
    projectId: config.projectId,
    workloadIdentityPoolId: config.poolId,
    workloadIdentityProviderId: config.providerId,
    serviceAccountEmail: config.serviceAccountEmail,
    allowImpersonation: true,
    allowedServiceAccounts: [
      'bigquery-reader@my-project.iam.gserviceaccount.com',
      'bigquery-admin@my-project.iam.gserviceaccount.com',
    ],
  });

  try {
    // Authenticate and impersonate
    const result = await wifAuth.authenticateAndImpersonate(
      config.oidcToken,
      'bigquery-reader@my-project.iam.gserviceaccount.com'
    );

    console.log('✅ Impersonation successful!');
    console.log('   Impersonated principal:', result.principal);
    console.log('   Impersonated:', result.impersonated);
    console.log('   Expires in:', result.expiresIn, 'seconds');

    return result;
  } catch (error) {
    console.error('❌ Impersonation failed:', error);
    throw error;
  }
}

// ==========================================
// Example 3: Credential Management
// ==========================================

export async function credentialManagement() {
  console.log('\n=== Example 3: Credential Management ===\n');

  const credManager = createCredentialManager({
    authMethod: 'wif',
    enableTokenCache: true,
    tokenRefreshBuffer: 300,
  });

  try {
    // Get access token (cached if available)
    console.log('Getting access token...');
    const tokenInfo = await credManager.getAccessToken();

    console.log('✅ Token obtained!');
    console.log('   Principal:', tokenInfo.principal);
    console.log('   Expires at:', new Date(tokenInfo.expiresAt).toISOString());
    console.log('   Scopes:', tokenInfo.scopes.join(', '));

    // Check cache stats
    const cacheStats = credManager.getCacheStats();
    console.log('\n📊 Cache Statistics:');
    console.log('   Enabled:', cacheStats.enabled);
    console.log('   Cached tokens:', cacheStats.size);

    // Validate credentials
    console.log('\n🔍 Validating credentials...');
    const health = await credManager.validateCredentials();

    console.log('   Healthy:', health.healthy);
    console.log('   Token valid:', health.tokenValid);
    console.log('   Expires in:', health.expiresIn, 'seconds');
    if (health.errors.length > 0) {
      console.log('   Errors:', health.errors);
    }

    // Enable auto-refresh
    console.log('\n🔄 Enabling auto-refresh (30 minutes)...');
    const cleanup = credManager.enableAutoRefresh(1800);

    // Simulate some work
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Cleanup
    cleanup();
    console.log('✅ Auto-refresh disabled');

    return tokenInfo;
  } catch (error) {
    console.error('❌ Credential management failed:', error);
    throw error;
  }
}

// ==========================================
// Example 4: Permission Validation
// ==========================================

export async function permissionValidation(principal: string) {
  console.log('\n=== Example 4: Permission Validation ===\n');

  const validator = new PermissionValidator({
    cacheTTLMs: 300000, // 5 minutes
    strictMode: true,
    auditEnabled: true,
    parallelValidation: true,
  });

  try {
    // Validate query permissions
    console.log('Validating query permissions...');
    const result = await validator.validateQueryPermissions({
      projectId: 'my-project',
      datasetId: 'my_dataset',
      tableId: 'my_table',
      principal,
    });

    if (result.allowed) {
      console.log('✅ Query authorized!');
      console.log('   Principal:', result.principal);
      console.log('   Cache hit:', result.cacheHit);
    } else {
      console.log('❌ Query denied!');
      console.log('   Missing permissions:', result.missingPermissions?.join(', '));
      console.log('   Reason:', result.deniedReason);
    }

    // Batch validation
    console.log('\n📦 Batch permission validation...');
    const batchResults = await validator.validateBatchPermissions([
      { projectId: 'my-project', datasetId: 'dataset1', action: 'query' },
      { projectId: 'my-project', datasetId: 'dataset2', action: 'query' },
      { projectId: 'my-project', datasetId: 'dataset3', action: 'query' },
    ]);

    batchResults.forEach((res, i) => {
      console.log(`   Dataset ${i + 1}:`, res.allowed ? '✅ Allowed' : '❌ Denied');
    });

    // Cache statistics
    const cacheStats = validator.getCacheStats();
    console.log('\n📊 Permission Cache:');
    console.log('   Size:', cacheStats.size);
    console.log('   Max size:', cacheStats.maxSize);
    console.log('   TTL:', cacheStats.ttlMs / 1000, 'seconds');

    return result;
  } catch (error) {
    console.error('❌ Permission validation failed:', error);
    throw error;
  }
}

// ==========================================
// Example 5: Audit Logging
// ==========================================

export async function auditLogging(principal: string) {
  console.log('\n=== Example 5: Audit Logging ===\n');

  const auditLogger = getAuditLogger({
    enableCloudLogging: true,
    retentionDays: 90,
  });

  // Log various events
  console.log('Logging authentication events...');

  // Authentication success
  auditLogger.logAuthSuccess({
    principal,
    principalType: 'wif',
    action: 'login',
    metadata: {
      ipAddress: '203.0.113.1',
      userAgent: 'MCP Client/1.0',
    },
  });
  console.log('   ✅ Logged auth success');

  // Authorization denial
  auditLogger.logAuthzDenial({
    principal,
    action: 'query',
    resource: 'projects/my-project/datasets/sensitive_data',
    reason: 'Missing bigquery.datasets.get permission',
  });
  console.log('   ❌ Logged authz denial');

  // Token operation
  auditLogger.logTokenOperation({
    eventType: AuditEventType.TOKEN_REFRESHED,
    principal,
    action: 'token_refresh',
    metadata: { expiresIn: 3600 },
  });
  console.log('   🔄 Logged token refresh');

  // Query audit trail
  console.log('\n📋 Querying audit trail...');
  const recentEvents = auditLogger.query({
    principal,
    limit: 10,
  });
  console.log(`   Found ${recentEvents.length} events for ${principal}`);

  // Get statistics
  console.log('\n📊 Audit Statistics:');
  const stats = auditLogger.getStatistics();
  console.log('   Total events:', stats.totalEvents);
  console.log('   Unique principals:', stats.uniquePrincipals);
  console.log('   Auth successes:', stats.authSuccesses);
  console.log('   Auth failures:', stats.authFailures);
  console.log('   Authz denials:', stats.authzDenials);
  console.log('   Security violations:', stats.securityViolations);

  // Export audit trail
  console.log('\n💾 Exporting audit trail...');
  const jsonExport = auditLogger.export('json');
  console.log('   JSON export size:', jsonExport.length, 'bytes');

  const csvExport = auditLogger.export('csv');
  console.log('   CSV export size:', csvExport.length, 'bytes');

  return stats;
}

// ==========================================
// Example 6: Complete Authentication Flow
// ==========================================

export async function completeAuthFlow(config: AuthConfig) {
  console.log('\n=== Example 6: Complete Authentication Flow ===\n');
  console.log('This demonstrates a complete enterprise authentication workflow.\n');

  try {
    // 1. Setup
    console.log('Step 1: Setting up authentication...');
    const wifAuth = createWIFAuthenticator({
      projectId: config.projectId,
      workloadIdentityPoolId: config.poolId,
      workloadIdentityProviderId: config.providerId,
      serviceAccountEmail: config.serviceAccountEmail,
      enableAuditLogging: true,
      strictValidation: true,
    });

    const permValidator = new PermissionValidator({
      strictMode: true,
      auditEnabled: true,
    });

    const auditLogger = getAuditLogger();

    // 2. Authenticate
    console.log('\nStep 2: Authenticating user...');
    const authResult = await wifAuth.authenticate(config.oidcToken);
    console.log('   ✅ Authenticated:', authResult.principal);

    // 3. Validate permissions
    console.log('\nStep 3: Validating permissions...');
    const permResult = await permValidator.validateQueryPermissions({
      projectId: config.projectId,
      datasetId: 'my_dataset',
      principal: authResult.principal,
    });

    if (!permResult.allowed) {
      console.log('   ❌ Permission denied!');
      console.log('   Missing:', permResult.missingPermissions?.join(', '));
      throw new Error('Insufficient permissions');
    }
    console.log('   ✅ Permissions validated');

    // 4. Execute query (simulated)
    console.log('\nStep 4: Executing query...');
    console.log('   SELECT * FROM my_dataset.my_table LIMIT 10');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    console.log('   ✅ Query executed successfully');

    // 5. Review audit trail
    console.log('\nStep 5: Reviewing audit trail...');
    const auditEvents = auditLogger.query({
      principal: authResult.principal,
      limit: 5,
    });
    console.log(`   Found ${auditEvents.length} audit events`);
    auditEvents.forEach((event, i) => {
      console.log(`   ${i + 1}. ${event.eventType} - ${event.outcome}`);
    });

    // 6. Cleanup
    console.log('\nStep 6: Session cleanup...');
    wifAuth.invalidateCache();
    console.log('   ✅ Tokens invalidated');

    console.log('\n✅ Complete authentication flow successful!\n');

    return {
      authentication: authResult,
      permissions: permResult,
      auditEvents,
    };
  } catch (error) {
    console.error('\n❌ Authentication flow failed:', error);
    throw error;
  }
}

// ==========================================
// Main Example Runner
// ==========================================

export async function runAllExamples() {
  const config: AuthConfig = {
    projectId: process.env.GCP_PROJECT_ID || 'my-project',
    poolId: process.env.WORKLOAD_IDENTITY_POOL_ID || 'my-pool',
    providerId: process.env.WORKLOAD_IDENTITY_PROVIDER_ID || 'my-provider',
    serviceAccountEmail:
      process.env.MCP_SERVICE_ACCOUNT_EMAIL || 'mcp@my-project.iam.gserviceaccount.com',
    oidcToken: process.env.OIDC_TOKEN || 'dummy-token-for-testing',
  };

  console.log('🔐 Enterprise Authentication Examples');
  console.log('=====================================\n');

  try {
    // Run examples
    const authResult = await basicWIFAuth(config);
    await serviceAccountImpersonation(config);
    await credentialManagement();
    await permissionValidation(authResult.principal);
    await auditLogging(authResult.principal);
    await completeAuthFlow(config);

    console.log('\n✅ All examples completed successfully!\n');
  } catch (error) {
    console.error('\n❌ Examples failed:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllExamples().catch(console.error);
}
