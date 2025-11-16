# Enterprise Authentication & Authorization Guide

## Overview

The BigQuery MCP Server implements comprehensive enterprise-grade authentication and authorization with:

- **Workload Identity Federation (WIF)** - Secure external identity integration
- **Service Account Impersonation** - Elevated permission delegation
- **Credential Management** - Token lifecycle and caching
- **Security Audit Logging** - Complete audit trail
- **IAM Permission Validation** - Pre-query authorization checks

## Architecture

### Components

```
┌─────────────────────────────────────────────────────────────┐
│                  Authentication Layer                        │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ WIF Auth     │  │ Workspace    │  │ Credential   │      │
│  │ Authenticator│  │ Auth         │  │ Manager      │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│         │                  │                 │               │
│         └──────────────────┴─────────────────┘               │
│                            │                                  │
│                  ┌─────────▼─────────┐                       │
│                  │  Security Audit   │                       │
│                  │  Logger           │                       │
│                  └───────────────────┘                       │
└─────────────────────────────────────────────────────────────┘
```

## 1. Workload Identity Federation (WIF)

### Setup

```typescript
import { createWIFAuthenticator } from './src/auth/index.js';

const wifAuth = createWIFAuthenticator({
  projectId: 'my-gcp-project',
  workloadIdentityPoolId: 'my-pool',
  workloadIdentityProviderId: 'my-provider',
  serviceAccountEmail: 'mcp-server@my-project.iam.gserviceaccount.com',

  // Token configuration
  tokenLifetime: 3600, // 1 hour
  enableTokenCache: true,

  // Security
  strictValidation: true,
  requireEmailVerification: true,
  allowedIssuers: ['https://accounts.google.com'],

  // Impersonation
  allowImpersonation: true,
  allowedServiceAccounts: [
    'bigquery-reader@my-project.iam.gserviceaccount.com',
  ],
});
```

### Basic Authentication

```typescript
// Authenticate with external OIDC token
const result = await wifAuth.authenticate(oidcToken);

console.log('Access Token:', result.accessToken);
console.log('Expires In:', result.expiresIn, 'seconds');
console.log('Principal:', result.principal);
```

### Service Account Impersonation

```typescript
// Authenticate and impersonate service account
const result = await wifAuth.authenticateAndImpersonate(
  oidcToken,
  'bigquery-admin@my-project.iam.gserviceaccount.com'
);

console.log('Impersonated:', result.impersonated); // true
console.log('Principal:', result.principal); // bigquery-admin@...
```

### Token Refresh

```typescript
// Manual refresh
const refreshed = await wifAuth.refreshToken();

// Auto-refresh every 30 minutes
const cleanup = wifAuth.enableAutoRefresh(1800);

// Cleanup when done
cleanup();
```

## 2. Credential Management

### Setup

```typescript
import { createCredentialManager } from './src/auth/index.js';

const credManager = createCredentialManager({
  authMethod: 'wif',

  wifConfig: {
    projectId: 'my-project',
    poolId: 'my-pool',
    providerId: 'my-provider',
    serviceAccountEmail: 'mcp@my-project.iam.gserviceaccount.com',
  },

  // Token management
  tokenRefreshBuffer: 300, // Refresh 5 min before expiry
  maxTokenAge: 3600,
  enableTokenCache: true,

  // Security
  enableEncryption: false,

  // Scopes
  scopes: [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/bigquery',
  ],
});
```

### Getting Tokens

```typescript
// Get access token (cached if available)
const tokenInfo = await credManager.getAccessToken();

console.log('Token:', tokenInfo.accessToken);
console.log('Expires At:', new Date(tokenInfo.expiresAt));
console.log('Scopes:', tokenInfo.scopes);
console.log('Principal:', tokenInfo.principal);
```

### Credential Health

```typescript
// Validate credentials
const health = await credManager.validateCredentials();

if (health.healthy) {
  console.log('Credentials are valid');
  console.log('Token expires in:', health.expiresIn, 'seconds');
} else {
  console.log('Credential issues:', health.errors);
}
```

### Cache Management

```typescript
// Get cache stats
const stats = credManager.getCacheStats();
console.log('Cached tokens:', stats.tokens);

// Invalidate cache
credManager.invalidateCache();

// Invalidate specific token
credManager.invalidateCache('access_token:wif');
```

## 3. Security Audit Logging

### Setup

```typescript
import { getAuditLogger } from './src/auth/index.js';

const auditLogger = getAuditLogger({
  enableCloudLogging: true,
  retentionDays: 90,
  maxEvents: 100000,
});
```

### Logging Events

```typescript
// Authentication success
auditLogger.logAuthSuccess({
  principal: 'user@example.com',
  principalType: 'wif',
  action: 'login',
  metadata: {
    ipAddress: '203.0.113.1',
    userAgent: 'MCP Client/1.0',
  },
});

// Authentication failure
auditLogger.logAuthFailure({
  principal: 'user@example.com',
  action: 'login',
  errorDetails: 'Invalid token',
});

// Authorization denial
auditLogger.logAuthzDenial({
  principal: 'user@example.com',
  action: 'query',
  resource: 'projects/my-project/datasets/sensitive',
  reason: 'Missing bigquery.datasets.get permission',
});

// Security violation
auditLogger.logSecurityViolation({
  principal: 'user@example.com',
  action: 'suspicious_query',
  severity: AuditSeverity.CRITICAL,
  message: 'Attempted to access restricted dataset',
});
```

### Querying Audit Trail

```typescript
// Get recent events
const recent = auditLogger.query({
  limit: 100,
});

// Get failures for specific user
const failures = auditLogger.query({
  principal: 'user@example.com',
  outcome: 'failure',
  limit: 50,
});

// Get security violations
const violations = auditLogger.query({
  eventType: AuditEventType.SECURITY_VIOLATION,
  startTime: new Date('2024-01-01'),
});

// Get denied access attempts
const denied = auditLogger.query({
  outcome: 'denied',
  limit: 100,
});
```

### Statistics & Reporting

```typescript
// Get statistics
const stats = auditLogger.getStatistics();

console.log('Total Events:', stats.totalEvents);
console.log('Unique Principals:', stats.uniquePrincipals);
console.log('Auth Successes:', stats.authSuccesses);
console.log('Auth Failures:', stats.authFailures);
console.log('Authz Denials:', stats.authzDenials);
console.log('Security Violations:', stats.securityViolations);

console.log('Events by Type:', stats.eventsByType);
console.log('Events by Severity:', stats.eventsBySeverity);
```

### Exporting Audit Logs

```typescript
// Export as JSON
const jsonExport = auditLogger.export('json');
await fs.writeFile('audit-trail.json', jsonExport);

// Export as CSV
const csvExport = auditLogger.export('csv');
await fs.writeFile('audit-trail.csv', csvExport);
```

## 4. Permission Validation

### Pre-Query Validation

```typescript
import { PermissionValidator } from './src/security/permission-validator.js';

const validator = new PermissionValidator({
  cacheTTLMs: 300000, // 5 minutes
  strictMode: true,
  auditEnabled: true,
});

// Validate query permissions
const result = await validator.validateQueryPermissions({
  projectId: 'my-project',
  datasetId: 'my_dataset',
  tableId: 'my_table',
  principal: 'user@example.com',
});

if (result.allowed) {
  // Execute query
  console.log('Query authorized');
} else {
  // Deny query
  console.log('Missing permissions:', result.missingPermissions);
}
```

### Batch Validation

```typescript
// Validate multiple resources in parallel
const results = await validator.validateBatchPermissions([
  { projectId: 'p1', datasetId: 'd1', action: 'query' },
  { projectId: 'p1', datasetId: 'd2', action: 'query' },
  { projectId: 'p2', datasetId: 'd1', action: 'query' },
]);

results.forEach(result => {
  console.log(`${result.resource}: ${result.allowed}`);
});
```

## 5. Integration Example

### Complete Authentication Flow

```typescript
import {
  createWIFAuthenticator,
  getAuditLogger,
} from './src/auth/index.js';
import { PermissionValidator } from './src/security/permission-validator.js';

// 1. Setup
const wifAuth = createWIFAuthenticator({
  projectId: process.env.GCP_PROJECT_ID!,
  workloadIdentityPoolId: process.env.WORKLOAD_IDENTITY_POOL_ID!,
  workloadIdentityProviderId: process.env.WORKLOAD_IDENTITY_PROVIDER_ID!,
  serviceAccountEmail: process.env.MCP_SERVICE_ACCOUNT_EMAIL!,
  enableAuditLogging: true,
});

const permValidator = new PermissionValidator({
  strictMode: true,
  auditEnabled: true,
});

// 2. Authenticate
async function authenticateUser(oidcToken: string) {
  try {
    const result = await wifAuth.authenticate(oidcToken);

    console.log('Authentication successful');
    console.log('Principal:', result.principal);
    console.log('Token expires in:', result.expiresIn, 'seconds');

    return result;
  } catch (error) {
    console.error('Authentication failed:', error);
    throw error;
  }
}

// 3. Validate permissions before query
async function executeQuery(principal: string, query: string) {
  // Extract resources from query (simplified)
  const projectId = 'my-project';
  const datasetId = 'my_dataset';

  // Check permissions
  const permResult = await permValidator.validateQueryPermissions({
    projectId,
    datasetId,
    principal,
  });

  if (!permResult.allowed) {
    throw new Error(
      `Permission denied. Missing: ${permResult.missingPermissions?.join(', ')}`
    );
  }

  // Execute query
  console.log('Query authorized, executing...');
  // ... execute query ...
}

// 4. Full flow
async function main() {
  const oidcToken = process.env.OIDC_TOKEN!;

  // Authenticate
  const auth = await authenticateUser(oidcToken);

  // Execute query with permission check
  await executeQuery(auth.principal, 'SELECT * FROM my_dataset.my_table');

  // View audit trail
  const auditLogger = getAuditLogger();
  const recentEvents = auditLogger.query({ limit: 10 });
  console.log('Recent audit events:', recentEvents);
}

main().catch(console.error);
```

## 6. Security Best Practices

### Token Management

1. **Enable Token Caching**: Reduce token acquisition overhead
2. **Set Appropriate Lifetimes**: Balance security and usability
3. **Use Auto-Refresh**: Prevent token expiration during operations
4. **Invalidate on Logout**: Clear tokens when user signs out

### Audit Logging

1. **Enable for Production**: Always enable audit logging in production
2. **Monitor Security Events**: Set up alerts for security violations
3. **Regular Reviews**: Review audit logs periodically
4. **Export for Compliance**: Export logs for compliance requirements

### Permission Validation

1. **Pre-Query Checks**: Validate permissions before executing queries
2. **Strict Mode**: Enable strict mode for production
3. **Cache Permissions**: Use caching to improve performance
4. **Batch Validation**: Validate multiple resources in parallel

### Impersonation

1. **Restrict Allowed Accounts**: Whitelist service accounts
2. **Short Lifetimes**: Use short token lifetimes for impersonation
3. **Audit All Impersonation**: Log every impersonation event
4. **Principle of Least Privilege**: Only impersonate when necessary

## 7. Monitoring & Troubleshooting

### Health Checks

```typescript
// Check credential health
const health = await credManager.validateCredentials();
console.log('Healthy:', health.healthy);
console.log('Errors:', health.errors);

// Check authentication
const isValid = await wifAuth.validateAuthentication();
console.log('Authentication valid:', isValid);
```

### Metrics

All authentication events are recorded in OpenTelemetry metrics:

- `auth.success` - Successful authentications
- `auth.failure` - Failed authentications
- `token.refresh` - Token refreshes
- `permission.denied` - Permission denials
- `security.violation` - Security violations

### Debugging

Enable debug logging:

```typescript
// Set LOG_LEVEL=debug in environment
process.env.LOG_LEVEL = 'debug';
```

View cache stats:

```typescript
const stats = credManager.getCacheStats();
console.log('Cache stats:', stats);
```

View audit statistics:

```typescript
const stats = auditLogger.getStatistics();
console.log('Audit stats:', stats);
```

## 8. Environment Configuration

Required environment variables:

```bash
# GCP Project
GCP_PROJECT_ID=my-gcp-project
GCP_REGION=us-central1

# Workload Identity Federation
WORKLOAD_IDENTITY_POOL_ID=my-pool
WORKLOAD_IDENTITY_PROVIDER_ID=my-provider
MCP_SERVICE_ACCOUNT_EMAIL=mcp@my-project.iam.gserviceaccount.com

# Google Workspace (optional)
GOOGLE_WORKSPACE_CLIENT_ID=123456.apps.googleusercontent.com
GOOGLE_WORKSPACE_DOMAIN=example.com
GOOGLE_WORKSPACE_ALLOWED_GROUPS=bigquery-users,data-analysts

# Security
ENABLE_CORS=true
ALLOWED_ORIGINS=https://app.example.com
MAX_QUERY_SIZE_BYTES=10485760

# Monitoring
ENABLE_METRICS=true
ENABLE_TRACING=true
```

## Summary

The enterprise authentication system provides:

✅ **Secure Authentication** - WIF, service accounts, OAuth2
✅ **Token Management** - Caching, refresh, rotation
✅ **Audit Logging** - Complete security audit trail
✅ **Permission Validation** - Pre-query authorization
✅ **Service Account Impersonation** - Secure privilege delegation
✅ **Production-Ready** - Comprehensive error handling and monitoring
