# Security Architecture

## Overview

The BigQuery MCP Server implements defense-in-depth security with multiple layers of protection, focusing on zero-trust principles and keyless authentication via Workload Identity Federation.

## Security Principles

1. **Zero Trust**: Never trust, always verify
2. **Least Privilege**: Minimum permissions required
3. **Defense in Depth**: Multiple security layers
4. **Keyless Authentication**: No service account keys
5. **Audit Everything**: Comprehensive logging
6. **Fail Secure**: Deny by default

## Authentication Architecture

### Workload Identity Federation (WIF)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Workload Identity Federation Flow                    │
└─────────────────────────────────────────────────────────────────────────┘

┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│   External   │         │   GCP STS    │         │   GCP IAM    │
│   Identity   │         │   Service    │         │   Service    │
│   Provider   │         │              │         │              │
└──────┬───────┘         └──────┬───────┘         └──────┬───────┘
       │                        │                        │
       │ 1. OIDC Token Request  │                        │
       │ (GitHub Actions,       │                        │
       │  Cloud Run, etc.)      │                        │
       │                        │                        │
       ▼                        │                        │
┌──────────────────────┐        │                        │
│ External IdP Issues  │        │                        │
│ OIDC Token           │        │                        │
│                      │        │                        │
│ Payload:             │        │                        │
│ {                    │        │                        │
│   iss: "github.com", │        │                        │
│   sub: "repo:org/...",        │                        │
│   aud: "//iam.goog...",       │                        │
│   exp: 1234567890    │        │                        │
│ }                    │        │                        │
└──────┬───────────────┘        │                        │
       │                        │                        │
       │ 2. Exchange Token      │                        │
       │────────────────────────►                        │
       │                        │                        │
       │ POST /v1/token         │                        │
       │ {                      │                        │
       │   subjectToken: <OIDC>,│                        │
       │   audience: "//iam...",│                        │
       │   ...                  │                        │
       │ }                      │                        │
       │                        │                        │
       │                        │ 3. Validate OIDC      │
       │                        │ - Verify signature     │
       │                        │ - Check issuer         │
       │                        │ - Validate audience    │
       │                        │ - Check expiration     │
       │                        │                        │
       │                        │ 4. Match Attribute     │
       │                        │    Condition           │
       │                        │ - assertion.repository │
       │                        │ - assertion.sub        │
       │                        │ - assertion.aud        │
       │                        │                        │
       │ 5. Return STS Token    │                        │
       │◄────────────────────────                        │
       │                        │                        │
       │ {                      │                        │
       │   access_token: "...", │                        │
       │   expires_in: 3600     │                        │
       │ }                      │                        │
       │                        │                        │
       │ 6. Impersonate Service Account                  │
       │─────────────────────────────────────────────────►
       │                        │                        │
       │ POST /v1/projects/-/serviceAccounts/{email}:generateAccessToken
       │ Authorization: Bearer <STS_TOKEN>               │
       │                        │                        │
       │                        │ 7. Validate STS Token  │
       │                        │ 8. Check IAM Bindings  │
       │                        │                        │
       │                        │ Service Account IAM:   │
       │                        │ - roles/iam.workloadIdentityUser
       │                        │   principal://iam.../│  │
       │                        │   attribute.repository/...
       │                        │                        │
       │ 9. Return Service Account Token                 │
       │◄─────────────────────────────────────────────────
       │                        │                        │
       │ {                      │                        │
       │   accessToken: "...",  │                        │
       │   expireTime: "..."    │                        │
       │ }                      │                        │
       │                        │                        │
```

### WIF Configuration

**Workload Identity Pool Setup:**
```bash
# Create workload identity pool
gcloud iam workload-identity-pools create "github-pool" \
  --project="${PROJECT_ID}" \
  --location="global" \
  --display-name="GitHub Actions Pool"

# Create provider (GitHub example)
gcloud iam workload-identity-pools providers create-oidc "github-provider" \
  --project="${PROJECT_ID}" \
  --location="global" \
  --workload-identity-pool="github-pool" \
  --display-name="GitHub Provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository" \
  --issuer-uri="https://token.actions.githubusercontent.com"

# Bind service account
gcloud iam service-accounts add-iam-policy-binding \
  "${SERVICE_ACCOUNT_EMAIL}" \
  --project="${PROJECT_ID}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-pool/attribute.repository/${GITHUB_REPO}"
```

**Attribute Conditions:**
```json
{
  "attributeCondition": "assertion.repository == 'org/repo-name' && assertion.repository_owner == 'org'"
}
```

### Token Management

```typescript
class TokenManager {
  private tokenCache: Map<string, CachedToken> = new Map();

  async getToken(): Promise<string> {
    const cacheKey = this.getCacheKey();

    // Check cache
    const cached = this.tokenCache.get(cacheKey);
    if (cached && !this.isExpiringSoon(cached, 300)) {
      return cached.token;
    }

    // Acquire new token
    const token = await this.acquireWIFToken();

    // Cache with expiry
    this.tokenCache.set(cacheKey, {
      token: token.accessToken,
      expiresAt: new Date(token.expireTime),
      acquiredAt: new Date()
    });

    return token.accessToken;
  }

  private isExpiringSoon(cached: CachedToken, bufferSeconds: number): boolean {
    const now = Date.now();
    const expiry = cached.expiresAt.getTime();
    return (expiry - now) < (bufferSeconds * 1000);
  }

  private async acquireWIFToken(): Promise<AccessToken> {
    // 1. Get OIDC token from environment
    const oidcToken = await this.getOIDCToken();

    // 2. Exchange for STS token
    const stsToken = await this.exchangeToken(oidcToken);

    // 3. Impersonate service account
    const saToken = await this.impersonateServiceAccount(stsToken);

    return saToken;
  }

  // Secure token cleanup
  clearTokens(): void {
    for (const [key, cached] of this.tokenCache.entries()) {
      // Zero out sensitive data
      cached.token = '';
      this.tokenCache.delete(key);
    }
  }
}
```

## Authorization Architecture

### IAM Roles and Permissions

```
┌─────────────────────────────────────────────────────────────┐
│                    IAM Permission Model                      │
└─────────────────────────────────────────────────────────────┘

Service Account: mcp-server@PROJECT.iam.gserviceaccount.com
│
├── BigQuery Roles
│   │
│   ├── roles/bigquery.dataViewer (Recommended)
│   │   ├── bigquery.datasets.get
│   │   ├── bigquery.tables.get
│   │   ├── bigquery.tables.list
│   │   ├── bigquery.tables.getData
│   │   └── bigquery.models.getData
│   │
│   ├── roles/bigquery.jobUser (Required)
│   │   ├── bigquery.jobs.create
│   │   └── bigquery.jobs.list
│   │
│   └── Custom Role: mcp.bigquery.reader (Most Secure)
│       ├── bigquery.datasets.get
│       ├── bigquery.tables.get
│       ├── bigquery.tables.list
│       ├── bigquery.tables.getData
│       ├── bigquery.jobs.create
│       ├── bigquery.jobs.get
│       └── bigquery.jobs.list
│
└── Monitoring Roles (Optional)
    │
    └── roles/monitoring.metricWriter
        ├── monitoring.metricDescriptors.create
        └── monitoring.timeSeries.create
```

### Custom IAM Role Definition

```yaml
title: "MCP BigQuery Reader"
description: "Minimal permissions for MCP BigQuery Server"
stage: "GA"
includedPermissions:
  # Dataset permissions
  - bigquery.datasets.get
  - bigquery.datasets.getIamPolicy

  # Table permissions
  - bigquery.tables.get
  - bigquery.tables.list
  - bigquery.tables.getData
  - bigquery.tables.getIamPolicy

  # Job permissions
  - bigquery.jobs.create
  - bigquery.jobs.get
  - bigquery.jobs.list

  # Monitoring (optional)
  - monitoring.timeSeries.create
```

### Permission Validation

```typescript
class AuthorizationManager {
  async validatePermissions(
    resource: string,
    requiredPermissions: string[]
  ): Promise<AuthResult> {
    try {
      // Get IAM policy for resource
      const policy = await this.getIAMPolicy(resource);

      // Check each required permission
      for (const permission of requiredPermissions) {
        if (!this.hasPermission(policy, permission)) {
          return {
            allowed: false,
            reason: `Missing permission: ${permission}`,
            suggestion: `Grant ${permission} to service account`
          };
        }
      }

      return { allowed: true };
    } catch (error) {
      logger.error('Permission validation failed', { error, resource });
      return {
        allowed: false,
        reason: 'Unable to validate permissions',
        error: error.message
      };
    }
  }

  private hasPermission(policy: IAMPolicy, permission: string): boolean {
    const serviceAccount = this.getServiceAccountEmail();

    for (const binding of policy.bindings) {
      if (binding.members.includes(`serviceAccount:${serviceAccount}`)) {
        const role = this.getRoleDefinition(binding.role);
        if (role.permissions.includes(permission)) {
          return true;
        }
      }
    }

    return false;
  }
}
```

## Data Protection

### Encryption

```
┌─────────────────────────────────────────────────────────────┐
│                    Encryption Layers                         │
└─────────────────────────────────────────────────────────────┘

1. Transport Layer (TLS 1.3)
   │
   ├── Client ←──[TLS 1.3]──→ MCP Server
   └── MCP Server ←──[TLS 1.3]──→ BigQuery API

2. BigQuery Data Encryption
   │
   ├── At Rest: AES-256 (Google-managed keys)
   ├── In Transit: TLS 1.3
   └── Column-level: AEAD encryption (optional)

3. Credential Storage
   │
   ├── OIDC Token: In-memory only, short-lived
   ├── STS Token: In-memory cache, 1hr TTL
   └── Service Account Token: In-memory cache, 1hr TTL
```

### Secrets Management

```typescript
class SecretManager {
  // NEVER store credentials in:
  // - Environment variables (except OIDC context)
  // - Config files
  // - Logs
  // - Error messages

  async loadWIFConfig(): Promise<WIFConfig> {
    // Option 1: Google Secret Manager (recommended)
    if (process.env.GCP_SECRET_NAME) {
      return this.loadFromSecretManager(process.env.GCP_SECRET_NAME);
    }

    // Option 2: Mounted volume (Kubernetes)
    if (process.env.WIF_CONFIG_PATH) {
      return this.loadFromFile(process.env.WIF_CONFIG_PATH);
    }

    // Option 3: Environment metadata (Cloud Run, GKE)
    return this.loadFromMetadata();
  }

  private async loadFromSecretManager(secretName: string): Promise<WIFConfig> {
    const client = new SecretManagerServiceClient();
    const [version] = await client.accessSecretVersion({
      name: `projects/${PROJECT_ID}/secrets/${secretName}/versions/latest`
    });

    const config = JSON.parse(version.payload.data.toString());
    return this.validateConfig(config);
  }
}
```

## Input Validation and Sanitization

### Model Armor Pre-Flight (Content Safety)

Before any tool executes, user-supplied text (queries, NL prompts) is passed
through a `ModelArmorProvider`. The provider decides `allow` or `block` and
the handler short-circuits on `block` with error code `MODEL_ARMOR_BLOCKED`.

| Provider | When used | Behavior |
|---|---|---|
| `NoopModelArmorProvider` | `MODEL_ARMOR_TEMPLATE` unset (default) | Always allows |
| `HttpModelArmorProvider` | `MODEL_ARMOR_TEMPLATE=projects/{p}/locations/{l}/templates/{t}` | Calls `modelarmor.{location}.rep.googleapis.com/v1/...:sanitizeUserPrompt` via ADC |
| `HeuristicModelArmorProvider` | Fallback when the HTTP call fails | Local pattern match; result marked `degraded: true` |

The HTTP provider uses Application Default Credentials from `google-auth-library`
so no additional keys are required. Source: `src/security/model-armor.ts`.

### SQL Injection Prevention

```typescript
class QueryValidator {
  private dangerousPatterns = [
    /;\s*DROP\s+/i,
    /;\s*DELETE\s+FROM\s+/i,
    /;\s*UPDATE\s+.*SET\s+/i,
    /EXEC\s*\(/i,
    /xp_cmdshell/i,
    /--\s*$/,  // SQL comments
    /\/\*.*\*\//  // Multi-line comments
  ];

  async validateQuery(query: string): Promise<ValidationResult> {
    // 1. Check for dangerous patterns
    for (const pattern of this.dangerousPatterns) {
      if (pattern.test(query)) {
        return {
          valid: false,
          reason: 'Query contains potentially dangerous pattern',
          pattern: pattern.toString()
        };
      }
    }

    // 2. Parse SQL (catches syntax errors)
    try {
      const ast = this.parseSQL(query);

      // 3. Only allow SELECT statements
      if (ast.type !== 'SELECT') {
        return {
          valid: false,
          reason: 'Only SELECT queries are allowed',
          actual: ast.type
        };
      }

      // 4. Check for subqueries (optional restriction)
      if (this.hasSubquery(ast)) {
        logger.warn('Query contains subquery', { query });
      }

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        reason: 'Invalid SQL syntax',
        error: error.message
      };
    }
  }

  // Use parameterized queries when possible
  buildParameterizedQuery(
    template: string,
    params: Record<string, any>
  ): Query {
    return {
      query: template,
      params: this.sanitizeParams(params),
      parameterMode: 'NAMED'
    };
  }

  private sanitizeParams(params: Record<string, any>): QueryParameter[] {
    return Object.entries(params).map(([name, value]) => ({
      name,
      parameterType: this.inferType(value),
      parameterValue: {
        value: this.escapeValue(value)
      }
    }));
  }
}
```

### Input Sanitization

```typescript
class InputSanitizer {
  sanitizeDatasetId(id: string): string {
    // Dataset IDs: alphanumeric and underscores only
    if (!/^[a-zA-Z0-9_]+$/.test(id)) {
      throw new Error('Invalid dataset ID format');
    }

    // Max length: 1024 characters
    if (id.length > 1024) {
      throw new Error('Dataset ID too long');
    }

    return id;
  }

  sanitizeTableId(id: string): string {
    // Table IDs: alphanumeric, underscores, hyphens
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      throw new Error('Invalid table ID format');
    }

    // Reserved prefixes
    if (id.startsWith('_') || id.startsWith('__')) {
      throw new Error('Table ID cannot start with underscore');
    }

    return id;
  }

  sanitizeProjectId(id: string): string {
    // Project IDs: lowercase, numbers, hyphens
    if (!/^[a-z0-9-]+$/.test(id)) {
      throw new Error('Invalid project ID format');
    }

    // Must start with letter
    if (!/^[a-z]/.test(id)) {
      throw new Error('Project ID must start with a letter');
    }

    return id;
  }
}
```

## Rate Limiting and Abuse Prevention

### Rate Limiter

```typescript
class RateLimiter {
  private readonly limits = {
    // Per-client limits
    queries_per_minute: 60,
    queries_per_hour: 1000,

    // Per-query limits
    max_query_size: 1024 * 1024,  // 1MB
    max_result_rows: 100000,
    max_execution_time: 300000,    // 5 minutes

    // Global limits
    concurrent_queries: 100
  };

  private clientBuckets: Map<string, TokenBucket> = new Map();

  async checkLimit(clientId: string, operation: string): Promise<RateLimitResult> {
    const bucket = this.getOrCreateBucket(clientId);

    if (!bucket.tryConsume(1)) {
      const resetTime = bucket.getResetTime();

      return {
        allowed: false,
        reason: 'Rate limit exceeded',
        limit: this.limits.queries_per_minute,
        resetAt: resetTime,
        retryAfter: Math.ceil((resetTime - Date.now()) / 1000)
      };
    }

    return { allowed: true };
  }

  private getOrCreateBucket(clientId: string): TokenBucket {
    if (!this.clientBuckets.has(clientId)) {
      this.clientBuckets.set(clientId, new TokenBucket({
        capacity: this.limits.queries_per_minute,
        fillRate: this.limits.queries_per_minute / 60  // per second
      }));
    }

    return this.clientBuckets.get(clientId)!;
  }
}
```

## Audit Logging

### Security Event Logging

```typescript
class AuditLogger {
  async logSecurityEvent(event: SecurityEvent): Promise<void> {
    const auditLog = {
      timestamp: new Date().toISOString(),
      severity: event.severity,
      category: 'SECURITY',
      principal: event.principal,
      action: event.action,
      resource: event.resource,
      result: event.result,
      metadata: {
        ...event.metadata,
        ip_address: event.sourceIP,
        user_agent: event.userAgent,
        request_id: event.requestId
      }
    };

    // Log to multiple destinations
    await Promise.all([
      this.logToFile(auditLog),
      this.logToCloudLogging(auditLog),
      this.sendToSIEM(auditLog)
    ]);

    // Alert on critical events
    if (event.severity === 'CRITICAL') {
      await this.sendAlert(auditLog);
    }
  }

  // Log all authentication attempts
  async logAuthAttempt(
    principal: string,
    success: boolean,
    reason?: string
  ): Promise<void> {
    await this.logSecurityEvent({
      severity: success ? 'INFO' : 'WARNING',
      principal,
      action: 'AUTHENTICATE',
      resource: 'WIF_TOKEN',
      result: success ? 'SUCCESS' : 'FAILURE',
      metadata: { reason }
    });
  }

  // Log all authorization checks
  async logAuthzCheck(
    principal: string,
    resource: string,
    action: string,
    allowed: boolean
  ): Promise<void> {
    await this.logSecurityEvent({
      severity: allowed ? 'INFO' : 'WARNING',
      principal,
      action,
      resource,
      result: allowed ? 'ALLOWED' : 'DENIED'
    });
  }

  // Log all data access
  async logDataAccess(
    principal: string,
    dataset: string,
    table: string,
    rowsAccessed: number
  ): Promise<void> {
    await this.logSecurityEvent({
      severity: 'INFO',
      principal,
      action: 'DATA_ACCESS',
      resource: `${dataset}.${table}`,
      result: 'SUCCESS',
      metadata: { rowsAccessed }
    });
  }
}
```

## Security Monitoring

### Threat Detection

```typescript
class ThreatDetector {
  async detectAnomalies(event: SecurityEvent): Promise<Threat[]> {
    const threats: Threat[] = [];

    // Detect brute force attempts
    if (await this.isBruteForce(event.principal)) {
      threats.push({
        type: 'BRUTE_FORCE',
        severity: 'HIGH',
        principal: event.principal,
        action: 'BLOCK_IP'
      });
    }

    // Detect privilege escalation
    if (await this.isPrivilegeEscalation(event)) {
      threats.push({
        type: 'PRIVILEGE_ESCALATION',
        severity: 'CRITICAL',
        principal: event.principal,
        action: 'REVOKE_TOKEN'
      });
    }

    // Detect data exfiltration
    if (await this.isDataExfiltration(event)) {
      threats.push({
        type: 'DATA_EXFILTRATION',
        severity: 'CRITICAL',
        principal: event.principal,
        action: 'ALERT_ADMIN'
      });
    }

    return threats;
  }

  private async isBruteForce(principal: string): Promise<boolean> {
    const failedAttempts = await this.getFailedAttempts(principal, 300); // 5min window
    return failedAttempts > 10;
  }

  private async isPrivilegeEscalation(event: SecurityEvent): Promise<boolean> {
    // Check if principal is attempting actions beyond their role
    const role = await this.getPrincipalRole(event.principal);
    const allowedActions = await this.getRolePermissions(role);

    return !allowedActions.includes(event.action);
  }

  private async isDataExfiltration(event: SecurityEvent): Promise<boolean> {
    // Check for unusually large data access
    const metadata = event.metadata as { rowsAccessed?: number };
    if (metadata.rowsAccessed && metadata.rowsAccessed > 100000) {
      return true;
    }

    // Check for unusual access patterns
    const recentAccess = await this.getRecentAccess(event.principal, 3600); // 1hr
    return recentAccess.length > 1000;
  }
}
```

## Security Checklist

### Pre-Deployment
- [ ] WIF properly configured with attribute conditions
- [ ] Service account has minimal IAM permissions
- [ ] No service account keys exist
- [ ] SQL injection prevention tested
- [ ] Rate limiting configured
- [ ] Audit logging enabled
- [ ] Security scanning passed (Checkov, Trivy)

### Runtime
- [ ] TLS 1.3 enforced for all connections
- [ ] Tokens refreshed before expiry
- [ ] All queries validated and sanitized
- [ ] Permission checks on every request
- [ ] Suspicious activity monitoring active
- [ ] Audit logs reviewed regularly

### Post-Incident
- [ ] Tokens revoked
- [ ] Audit trail preserved
- [ ] Root cause identified
- [ ] Security patches applied
- [ ] Monitoring enhanced

## Next Steps

See [Error Handling Strategy](./05-error-handling.md) for fault tolerance and recovery patterns.
