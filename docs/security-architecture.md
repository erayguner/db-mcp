# Security Architecture - BigQuery MCP Server

## Overview

This document describes the enterprise security architecture implemented for the BigQuery MCP Server.

## Security Layers

### 1. Authentication Layer

**Components:**
- `/src/auth/credential-manager.ts` - Token lifecycle management
- `/src/auth/wif-authenticator.ts` - WIF authentication and impersonation
- `/src/auth/workload-identity.ts` - Token exchange
- `/src/auth/google-workspace.ts` - Workspace OIDC validation

**Features:**
- ✅ Workload Identity Federation (WIF)
- ✅ Service Account Impersonation
- ✅ Token caching with TTL
- ✅ Automatic token refresh
- ✅ Multi-method authentication (WIF, OAuth2, Service Account, Compute)

### 2. Authorization Layer

**Components:**
- `/src/security/permission-validator.ts` - IAM permission validation
- `/src/auth/audit-logger.ts` - Security audit logging

**Features:**
- ✅ Pre-query permission checks
- ✅ IAM policy evaluation
- ✅ Role-based access control (RBAC)
- ✅ Permission caching (5-minute TTL)
- ✅ Batch permission validation
- ✅ Comprehensive audit trail

### 3. Audit & Compliance Layer

**Components:**
- `/src/auth/audit-logger.ts` - Security event logging

**Features:**
- ✅ Authentication/authorization event logging
- ✅ Token operation tracking
- ✅ Security violation detection
- ✅ Audit trail querying and export
- ✅ Compliance reporting (JSON/CSV)
- ✅ 90-day retention (configurable)

## Security Patterns

### Pattern 1: WIF Token Exchange

```typescript
// External OIDC Token → GCP Access Token
const wifAuth = new WIFAuthenticator(config);
const result = await wifAuth.authenticate(oidcToken);
// Result: { accessToken, expiresAt, principal }
```

**Flow:**
1. Validate external OIDC token
2. Exchange with WIF pool/provider
3. Obtain GCP access token
4. Cache with TTL
5. Log authentication event

### Pattern 2: Service Account Impersonation

```typescript
// WIF Token → Impersonated Service Account Token
const result = await wifAuth.authenticateAndImpersonate(
  oidcToken,
  'target-sa@project.iam.gserviceaccount.com'
);
// Result: { accessToken, principal, impersonated: true }
```

**Flow:**
1. Authenticate with WIF
2. Validate target service account
3. Call IAM Credentials API
4. Obtain short-lived impersonation token
5. Log impersonation event

### Pattern 3: Token Refresh

```typescript
// Automatic refresh 5 minutes before expiry
const credManager = new CredentialManager({
  tokenRefreshBuffer: 300, // 5 minutes
  enableTokenCache: true,
});

// Enable auto-refresh
const cleanup = credManager.enableAutoRefresh(1800); // 30 min
```

**Flow:**
1. Check token expiry in cache
2. If within refresh buffer, refresh
3. Obtain new token
4. Update cache
5. Log refresh event

### Pattern 4: Permission Validation

```typescript
// Pre-query permission check
const validator = new PermissionValidator();
const result = await validator.validateQueryPermissions({
  projectId: 'my-project',
  datasetId: 'my_dataset',
  principal: 'user@example.com',
});

if (!result.allowed) {
  throw new Error(`Missing: ${result.missingPermissions}`);
}
```

**Flow:**
1. Check permission cache
2. If miss, call IAM testPermissions API
3. Cache result (5-minute TTL)
4. Log authorization decision
5. Return allow/deny result

### Pattern 5: Audit Logging

```typescript
// Comprehensive security event logging
const auditLogger = getAuditLogger();

// Authentication
auditLogger.logAuthSuccess({ principal, action });
auditLogger.logAuthFailure({ principal, errorDetails });

// Authorization
auditLogger.logAuthzDenial({ principal, resource, reason });

// Security
auditLogger.logSecurityViolation({ principal, severity, message });
```

**Storage:**
- In-memory store (100K events)
- 90-day retention
- Automatic cleanup
- Export to JSON/CSV
- Cloud Logging integration

## Security Configurations

### Credential Manager Configuration

```typescript
{
  authMethod: 'wif',
  tokenRefreshBuffer: 300,     // Refresh 5 min before expiry
  maxTokenAge: 3600,            // 1 hour max
  enableTokenCache: true,       // Cache tokens
  scopes: [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/bigquery'
  ]
}
```

### WIF Authenticator Configuration

```typescript
{
  strictValidation: true,           // Enforce strict token validation
  requireEmailVerification: true,   // Require verified emails
  allowImpersonation: true,         // Enable impersonation
  impersonationLifetime: 3600,      // 1-hour impersonation tokens
  allowedServiceAccounts: [...],    // Whitelist service accounts
  enableAuditLogging: true          // Enable audit trail
}
```

### Permission Validator Configuration

```typescript
{
  cacheTTLMs: 300000,              // 5-minute cache
  cacheSize: 1000,                 // 1000 cached entries
  strictMode: true,                // Fail closed on errors
  auditEnabled: true,              // Log all checks
  parallelValidation: true,        // Parallel batch checks
  maxConcurrentChecks: 10          // 10 concurrent checks
}
```

### Audit Logger Configuration

```typescript
{
  maxEvents: 100000,               // 100K events in memory
  retentionDays: 90,               // 90-day retention
  enableCloudLogging: true         // Send to Cloud Logging
}
```

## Security Best Practices

### 1. Token Management

- ✅ Enable token caching for performance
- ✅ Set short token lifetimes (1 hour)
- ✅ Use auto-refresh to prevent expiration
- ✅ Invalidate tokens on logout
- ✅ Monitor token acquisition failures

### 2. Permission Validation

- ✅ Always validate before queries
- ✅ Use strict mode in production
- ✅ Cache permissions for performance
- ✅ Batch validate for bulk operations
- ✅ Monitor permission denials

### 3. Service Account Impersonation

- ✅ Whitelist allowed service accounts
- ✅ Use short impersonation lifetimes
- ✅ Log all impersonation events
- ✅ Apply principle of least privilege
- ✅ Monitor impersonation failures

### 4. Audit Logging

- ✅ Enable in production
- ✅ Set up alerts for security violations
- ✅ Regular audit log reviews
- ✅ Export logs for compliance
- ✅ Monitor authentication failures

### 5. Secret Management

- ✅ Never hardcode credentials
- ✅ Use environment variables
- ✅ Rotate service account keys
- ✅ Use Secret Manager for production
- ✅ Audit secret access

## Monitoring & Alerts

### Key Metrics

**Authentication:**
- `auth.success` - Successful authentications
- `auth.failure` - Failed authentications
- `token.refresh` - Token refreshes
- `impersonation.success` - Successful impersonations

**Authorization:**
- `permission.check` - Permission checks
- `permission.denied` - Permission denials
- `permission.cache_hit` - Cache hits

**Security:**
- `security.violation` - Security violations
- `security.rate_limit` - Rate limit exceeded
- `security.invalid_token` - Invalid tokens

### Alert Conditions

**Critical Alerts:**
- Multiple authentication failures (>5 in 5 min)
- Security violations
- Invalid token detections
- Service account impersonation failures

**Warning Alerts:**
- Permission denials (>10 in 10 min)
- Token refresh failures
- Cache invalidation patterns

**Info Alerts:**
- High permission cache miss rate
- Token expiration warnings
- Audit log size warnings

## Compliance & Reporting

### Audit Trail Export

```typescript
// Export audit trail for compliance
const auditLogger = getAuditLogger();

// JSON export
const jsonExport = auditLogger.export('json');
await fs.writeFile('audit-2024-01.json', jsonExport);

// CSV export for spreadsheets
const csvExport = auditLogger.export('csv');
await fs.writeFile('audit-2024-01.csv', csvExport);
```

### Compliance Reports

**Required Reports:**
1. Authentication audit trail
2. Authorization decisions
3. Permission denials summary
4. Security violations
5. Service account impersonation log

**Report Frequency:**
- Daily: Security violations
- Weekly: Permission denials
- Monthly: Full audit trail
- Quarterly: Compliance summary

## Incident Response

### Authentication Failure

1. Check audit logs for failure reason
2. Verify token validity and expiration
3. Check WIF pool/provider configuration
4. Review Cloud Logging for detailed errors
5. Invalidate cache and retry

### Permission Denial

1. Check required permissions in logs
2. Verify IAM policy grants
3. Check service account impersonation
4. Review resource-level permissions
5. Update IAM policies if needed

### Security Violation

1. Review audit log details
2. Identify principal and action
3. Check for pattern of violations
4. Investigate potential compromise
5. Revoke tokens if necessary
6. Update security policies

## File Reference

### Authentication

- `/src/auth/credential-manager.ts` - 475 lines
- `/src/auth/wif-authenticator.ts` - 425 lines
- `/src/auth/audit-logger.ts` - 528 lines
- `/src/auth/workload-identity.ts` - 144 lines
- `/src/auth/google-workspace.ts` - 120 lines
- `/src/auth/index.ts` - 127 lines

### Authorization

- `/src/security/permission-validator.ts` - 857 lines
- `/src/security/middleware.ts` - Existing
- `/src/security/config.ts` - Existing

### Documentation

- `/docs/authentication-guide.md` - Complete usage guide
- `/docs/security-architecture.md` - This document

Total: ~2,676 lines of enterprise security code
