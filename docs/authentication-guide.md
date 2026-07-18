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
│  ┌──────────────┐          │                 │               │
│  │ OIDC         │          │                 │               │
│  │ Authenticator│          │                 │               │
│  └──────────────┘          │                 │               │
│         │                  │                 │               │
│         └──────────────────┴─────────────────┘               │
│                            │                                  │
│                  ┌─────────▼─────────┐                       │
│                  │  Security Audit   │                       │
│                  │  Logger           │                       │
│                  └───────────────────┘                       │
└─────────────────────────────────────────────────────────────┘
```

## OIDC Authentication (New)

The server now supports generic OIDC JWT authentication with any compliant identity provider (Google, Okta, Auth0, Azure
AD).

### Configuration

```typescript
import { OIDCAuthenticator } from './src/auth/oidc-authenticator.js';

const authenticator = new OIDCAuthenticator({
  issuer: 'https://accounts.google.com',
  audience: 'my-mcp-server',
  jwksUri: 'https://www.googleapis.com/oauth2/v3/certs', // optional, auto-discovered
  requiredScopes: ['bigquery.readonly'],
  clockToleranceSec: 30, // default
});

const principal = await authenticator.authenticate('Bearer <jwt-token>');
// Returns: { subject, email, issuer, audience, scopes, claims, authenticatedAt }
```

### Auth Middleware

The `AuthMiddleware` wraps the OIDC authenticator for use in the MCP request pipeline:

```typescript
import { AuthMiddleware } from './src/auth/auth-middleware.js';

const authMiddleware = new AuthMiddleware({
  oidc: {
    issuer: 'https://accounts.google.com',
    audience: 'my-mcp-server',
  },
  requireAuth: true,
  bypassTools: ['list_tools'], // tools that don't need auth
});

const result = await authMiddleware.authenticate(requestHeaders);
if (!result.authenticated) {
  // Handle auth failure
}
// result.principal contains the authenticated user info
```

### Tenant Resolution

Authenticated principals are automatically resolved to tenants via the `TenantContextFactory`:

- Email patterns in `tenants.yaml` (`oidcSubjectPattern`) match against JWT claims
- Falls back to a default tenant if no pattern matches
- Each tenant gets isolated dataset access policies

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

  // Signature verification — required unless explicitly opted out
  jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
  clockToleranceSec: 30, // default; max 300

  // Security
  requireEmailVerification: true,
  allowedIssuers: ['https://accounts.google.com'],
  allowedAudiences: [
    '//iam.googleapis.com/projects/123/locations/global/workloadIdentityPools/my-pool/providers/my-provider',
  ],

  // Impersonation
  allowImpersonation: true,
  allowedServiceAccounts: ['bigquery-reader@my-project.iam.gserviceaccount.com'],
});
```

### Token signature verification

Inbound OIDC tokens are signature-verified with `jose` against the JWKS endpoint at `jwksUri`. The authenticator **fails
closed at construction**: without `jwksUri` it throws

```text
WIFAuthConfig requires `jwksUri` so inbound OIDC tokens can be signature-verified.
Set `allowUnverifiedTokens: true` only if the signature has already been verified upstream.
```

`allowUnverifiedTokens: true` (default `false`) is the sole escape hatch, and only appropriate when an upstream layer
has already verified the signature. Enabling it logs a warning, because unverified token claims are attacker
controllable.

Claim validation:

| Claim            | Enforcement                                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| Signature        | `jose` against the JWKS at `jwksUri`                                                                            |
| `exp`            | By `jose`, and again explicitly, so the unverified path is still expiry-checked                                 |
| `iss`            | Passed to `jose` when exactly one `allowedIssuers` entry is configured; otherwise checked against the allowlist |
| `aud`            | Checked against `allowedAudiences`. **Not validated at all if `allowedAudiences` is unset**                     |
| `email_verified` | Enforced when `requireEmailVerification` is true and an `email` claim is present                                |

Clock skew tolerance is `clockToleranceSec` (default 30, max 300).

> **Which authenticator runs on the request path?** `OIDCAuthenticator` — not `WIFAuthenticator`. The HTTP transport
> authenticates inbound requests through `AuthMiddleware` → `OIDCAuthenticator`, which always verifies signatures, has
> no unverified escape hatch, and requires an `audience`. `WIFAuthenticator` is a library surface for token exchange and
> impersonation; nothing in the server request path constructs one.

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
const result = await wifAuth.authenticateAndImpersonate(oidcToken, 'bigquery-admin@my-project.iam.gserviceaccount.com');

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
  scopes: ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/bigquery'],
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

## 4. IAM Permission Validation

Project-level IAM permission checks live in `MultiProjectManager` (`src/bigquery/multi-project-manager.ts`).

> **Scope:** this is the multi-project discovery component. It is **not** on the MCP request path — the running server
> does not instantiate it. Per-request authorization on the MCP path is enforced by `DatasetPolicy` and the tenant
> allowlist (see [security-architecture.md](./security-architecture.md)). Use the API below when embedding the manager
> directly.

### Checking permissions

`validatePermission()` queries the Cloud Resource Manager v3 `projects:testIamPermissions` API. It reports what IAM
actually returned — it never assumes a permission set from a successful query.

```typescript
import { MultiProjectManager } from './src/bigquery/index.js';

const manager = new MultiProjectManager({
  permissionValidation: {
    enabled: true,
    cacheValidationResults: true,
    validationTTLMs: 300_000, // 5 minutes; minimum 60_000
  },
});

const result = await manager.validatePermission('my-project', 'query', ['bigquery.jobs.create']);

if (result.hasAccess) {
  console.log('Authorized. Verified against IAM:', result.verified);
}
```

### Outcomes

Every check resolves to one of three statuses, on both `PermissionCheckOutcome.status` and
`PermissionValidationResult.status`:

| Status       | Meaning                                                      | `verified` | `granted`   |
| ------------ | ------------------------------------------------------------ | ---------- | ----------- |
| `verified`   | IAM answered; the answer is authoritative                    | `true`     | populated   |
| `unverified` | The check itself failed; no answer was obtained              | `false`    | always `[]` |
| `disabled`   | `permissionValidation.enabled` is `false` — no check was run | `false`    | always `[]` |

`granted` is always empty unless `status === 'verified'`, so an empty array can never be mistaken for "checked and found
nothing".

### Failure modes

Both failure modes deny the operation. They are distinct types so operators and alerting can tell an authorization
failure apart from an infrastructure fault:

- **`PermissionDeniedError`** (code `PERMISSION_DENIED`) — IAM answered and the principal is missing permissions.
  Carries `details.missingPermissions`.
- **`PermissionCheckFailedError`** (code `PERMISSION_CHECK_FAILED`) — IAM never answered. Message ends
  `Denying access (fail-closed).` Thrown when the API call fails, when the outcome is not `verified`, and when
  `requiredPermissions` is empty — an empty requirement set must not vacuously grant access.

### Caching

Only genuinely verified answers are cached, and both grants and denials are stored — both are facts. A **failed check is
never cached**: a transient failure must not become a durable authorization decision in either direction.

A cache hit requires an unexpired entry that covers _every_ requested permission; partial coverage falls through to a
live IAM call. Invalidate manually with `manager.invalidatePermissionCache(projectId?)`.

Default probe permission set (`DEFAULT_BIGQUERY_PROBE_PERMISSIONS`): `bigquery.jobs.create`, `bigquery.datasets.get`,
`bigquery.datasets.create`, `bigquery.tables.list`, `bigquery.tables.get`, `bigquery.tables.getData`. Requests are
batched at 100 permissions per API call.

### Disabling the check

Set `permissionValidation.enabled: false` in the manager config. Every check then returns `hasAccess: true` with
`status: 'disabled'` and `permissions: []` — nothing is verified, so nothing is asserted. This is an explicit operator
opt-out, configurable in code only; there is no environment variable for it. The default is enabled.

## 5. Integration Example

### Complete Authentication Flow

```typescript
import { createWIFAuthenticator, getAuditLogger } from './src/auth/index.js';
import { MultiProjectManager } from './src/bigquery/index.js';

// 1. Setup
const wifAuth = createWIFAuthenticator({
  projectId: process.env.GCP_PROJECT_ID!,
  workloadIdentityPoolId: process.env.WORKLOAD_IDENTITY_POOL_ID!,
  workloadIdentityProviderId: process.env.WORKLOAD_IDENTITY_PROVIDER_ID!,
  serviceAccountEmail: process.env.MCP_SERVICE_ACCOUNT_EMAIL!,
  jwksUri: process.env.WIF_JWKS_URI!,
  enableAuditLogging: true,
});

const projectManager = new MultiProjectManager({
  permissionValidation: { enabled: true, cacheValidationResults: true, validationTTLMs: 300_000 },
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
  const projectId = 'my-project';

  // Throws PermissionDeniedError (IAM said no) or
  // PermissionCheckFailedError (no answer obtained — fail closed).
  const permResult = await projectManager.validatePermission(projectId, 'query', ['bigquery.jobs.create']);

  console.log('Authorized. Verified against IAM:', permResult.verified);

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

1. **Never Infer Permissions**: A successful query proves only that one query was allowed; check IAM directly
2. **Keep Validation Enabled**: `permissionValidation.enabled: false` asserts nothing about access
3. **Distinguish the Failure Modes**: Alert on `PermissionCheckFailedError` separately — it signals an infrastructure or
   credential fault, not a policy decision
4. **Never Cache a Failed Check**: A transient failure must not become a durable authorization decision
5. **Specify Required Permissions**: An empty requirement set is denied, not vacuously granted

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
```

## Summary

The enterprise authentication system provides:

✅ **Secure Authentication** - WIF, service accounts, OAuth2 ✅ **Token Management** - Caching, refresh, rotation ✅
**Audit Logging** - Complete security audit trail ✅ **Permission Validation** - Pre-query authorization ✅ **Service
Account Impersonation** - Secure privilege delegation ✅ **Production-Ready** - Comprehensive error handling and
monitoring
