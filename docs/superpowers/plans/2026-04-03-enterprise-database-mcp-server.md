# Enterprise-Grade Database MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the existing BigQuery MCP server into a production-ready, enterprise-grade database MCP platform that
securely provides dataset access to customers via MCP protocol with multi-tenant isolation, OIDC authentication,
fine-grained authorization, comprehensive auditing, and Cloud Run deployment.

**Architecture:** The server uses a layered architecture: MCP Protocol Layer (JSON-RPC over stdio/HTTP) ->
Authentication Gateway (OIDC + WIF) -> Authorization Engine (per-tenant dataset policies) -> BigQuery Data Layer
(connection pooling, query optimization). Each customer tenant gets an isolated configuration with allowlisted datasets,
enforced via a tenant-aware middleware chain. Observability is handled through OpenTelemetry tracing/metrics exported to
Cloud Trace and Cloud Monitoring.

**Tech Stack:** TypeScript 6.0+, Node.js 22+, `@modelcontextprotocol/sdk`, `@google-cloud/bigquery`,
`google-auth-library`, Zod validation, OpenTelemetry, Cloud Run, Terraform, Docker.

---

## Current State Assessment

The existing codebase at `/Users/eray/db-mcp` already provides:

| Component             | Status  | Location                               | Notes                                                                    |
| --------------------- | ------- | -------------------------------------- | ------------------------------------------------------------------------ |
| MCP Server Factory    | Working | `src/mcp/server-factory.ts`            | stdio transport only; SSE/WebSocket stubs                                |
| Tool Handlers         | Working | `src/mcp/handlers/tool-handlers.ts`    | 4 tools: query, list_datasets, list_tables, get_table_schema             |
| BigQuery Client       | Working | `src/bigquery/client.ts`               | Connection pooling, retry, query builder                                 |
| Connection Pool       | Working | `src/bigquery/connection-pool.ts`      | Min/max connections, health checks, metrics                              |
| WIF Auth              | Partial | `src/auth/workload-identity.ts`        | Token exchange + cache, but not wired into request pipeline              |
| Google Workspace Auth | Partial | `src/auth/google-workspace.ts`         | OIDC token verification, domain + group checks                           |
| Security Middleware   | Working | `src/security/middleware.ts`           | Rate limiting, prompt injection, SQL injection, sensitive data redaction |
| Permission Validator  | Working | `src/security/permission-validator.ts` | IAM testIamPermissions, caching, audit trail                             |
| Audit Logger          | Working | `src/auth/audit-logger.ts`             | In-memory event store, Cloud Logging integration                         |
| Health Monitor        | Working | `src/monitoring/health-monitor.ts`     | Multi-component health, readiness/liveness probes                        |
| Telemetry             | Working | `src/telemetry/`                       | OpenTelemetry tracing + metrics, Cloud Trace/Monitoring export           |
| Terraform             | Working | `terraform/`                           | WIF, IAM, BigQuery, Cloud Run, Networking, Monitoring modules            |
| Tool Schemas          | Working | `src/mcp/schemas/tool-schemas.ts`      | Zod validation for all tool inputs                                       |

### Critical Gaps to Address

1. **No multi-tenant isolation** - All requests share one BigQuery project/credential set
2. **Auth not wired into MCP pipeline** - WIF and Workspace auth exist but aren't called during tool execution
3. **No dataset-level access control** - Any authenticated user can query any dataset
4. **No HTTP transport** - Only stdio; customers can't connect remotely
5. **No structured query templates** - Only raw SQL execution (arbitrary query risk)
6. **No write-mode controls** - No protection against DML/DDL through query tool
7. **Tool annotations missing** - MCP spec annotations (readOnly, destructive, idempotent) not set
8. **Audit events not persisted** - In-memory only; lost on restart
9. **No per-tenant rate limiting** - Rate limits are per-tool, not per-customer
10. **No graceful config reload** - Tenant config changes require restart

---

## File Structure

### New Files to Create

```
src/
  auth/
    oidc-authenticator.ts       # Generic OIDC token validation with JWKS caching
    auth-middleware.ts           # Request-level auth chain (extract token -> validate -> inject principal)
  tenancy/
    tenant-config.ts            # Tenant definition schema and loader (YAML config)
    tenant-registry.ts          # In-memory tenant registry with hot-reload
    tenant-context.ts           # Per-request tenant context (principal, allowed datasets, write mode)
    dataset-policy.ts           # Per-tenant dataset allowlist/denylist enforcement
  mcp/
    transports/
      http-transport.ts         # Streamable HTTP transport for remote MCP clients
    tools/
      annotations.ts            # MCP tool annotation helpers (readOnly, destructive hints)
      structured-queries.ts     # Pre-defined parameterized query templates per tenant
  config/
    tenants.yaml                # Tenant configuration file (loaded at startup + hot-reloaded)

tests/
  unit/
    auth/
      oidc-authenticator.test.ts
      auth-middleware.test.ts
    tenancy/
      tenant-config.test.ts
      tenant-registry.test.ts
      tenant-context.test.ts
      dataset-policy.test.ts
    mcp/
      http-transport.test.ts
      annotations.test.ts
      structured-queries.test.ts
  integration/
    tenant-isolation.test.ts
    auth-flow.test.ts
    http-transport.test.ts
```

### Existing Files to Modify

```
src/index.ts                        # Wire auth middleware, tenant context, HTTP transport
src/mcp/server-factory.ts           # Add HTTP transport support
src/mcp/handlers/tool-handlers.ts   # Inject tenant context, enforce dataset policies
src/mcp/tools/definitions.ts        # Add MCP tool annotations
src/security/middleware.ts           # Per-tenant rate limiting, write-mode enforcement
src/config/environment.ts            # Add tenant config path, HTTP transport settings
src/bigquery/client.ts              # Accept per-request project/dataset scoping
terraform/main.tf                    # Add Cloud Armor WAF rules, Secret Manager for tenant configs
terraform/modules/cloud-run/main.tf  # HTTP ingress, min-instances for latency
```

---

## Phase 1: Authentication Gateway

### Task 1: Generic OIDC Authenticator

**Files:**

- Create: `src/auth/oidc-authenticator.ts`
- Test: `tests/unit/auth/oidc-authenticator.test.ts`

This module validates OIDC JWTs from any compliant identity provider (Google, Okta, Auth0, Azure AD) using JWKS
discovery and key caching. Google's `genai-toolbox` uses this exact pattern (`internal/auth/generic/generic.go`) for
multi-provider support.

- [ ] **Step 1: Write the failing test for OIDC config validation**

```typescript
// tests/unit/auth/oidc-authenticator.test.ts
import { describe, it, expect } from '@jest/globals';
import { OIDCConfigSchema, OIDCAuthenticator } from '../../src/auth/oidc-authenticator.js';

describe('OIDCAuthenticator', () => {
  describe('OIDCConfigSchema', () => {
    it('validates a complete OIDC config', () => {
      const config = {
        issuer: 'https://accounts.google.com',
        audience: 'my-mcp-server',
        jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
        requiredScopes: ['bigquery.readonly'],
        clockToleranceSec: 30,
      };
      const result = OIDCConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('rejects config without issuer', () => {
      const config = { audience: 'my-server' };
      const result = OIDCConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('rejects non-HTTPS issuer in production', () => {
      const config = {
        issuer: 'http://insecure-issuer.com',
        audience: 'my-server',
      };
      const result = OIDCConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('defaults clockToleranceSec to 30', () => {
      const config = {
        issuer: 'https://accounts.google.com',
        audience: 'my-server',
      };
      const result = OIDCConfigSchema.parse(config);
      expect(result.clockToleranceSec).toBe(30);
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/auth/oidc-authenticator.test.ts --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Implement OIDCAuthenticator**

```typescript
// src/auth/oidc-authenticator.ts
import { z } from 'zod';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import { logger } from '../utils/logger.js';

export const OIDCConfigSchema = z.object({
  issuer: z
    .string()
    .url()
    .refine((url) => url.startsWith('https://'), { message: 'Issuer must use HTTPS' }),
  audience: z.string().min(1),
  jwksUri: z.string().url().optional(),
  requiredScopes: z.array(z.string()).default([]),
  clockToleranceSec: z.number().min(0).max(300).default(30),
});

export type OIDCConfig = z.infer<typeof OIDCConfigSchema>;

export interface AuthenticatedPrincipal {
  subject: string; // sub claim
  email: string; // email claim
  issuer: string; // iss claim
  audience: string; // aud claim
  scopes: string[]; // scope claim (split by space)
  claims: JWTPayload; // full JWT payload
  authenticatedAt: Date;
}

export class OIDCAuthenticationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 401
  ) {
    super(message);
    this.name = 'OIDCAuthenticationError';
  }
}

export class OIDCAuthenticator {
  private config: OIDCConfig;
  private jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(config: OIDCConfig) {
    this.config = OIDCConfigSchema.parse(config);

    const jwksUrl = this.config.jwksUri || `${this.config.issuer}/.well-known/jwks.json`;

    this.jwks = createRemoteJWKSet(new URL(jwksUrl));

    logger.info('OIDC authenticator initialized', {
      issuer: this.config.issuer,
      audience: this.config.audience,
    });
  }

  async authenticate(token: string): Promise<AuthenticatedPrincipal> {
    if (!token) {
      throw new OIDCAuthenticationError('No token provided', 'MISSING_TOKEN');
    }

    // Strip "Bearer " prefix if present
    const jwt = token.startsWith('Bearer ') ? token.slice(7) : token;

    try {
      const { payload } = await jwtVerify(jwt, this.jwks, {
        issuer: this.config.issuer,
        audience: this.config.audience,
        clockTolerance: this.config.clockToleranceSec,
      });

      // Validate required scopes
      const tokenScopes = typeof payload.scope === 'string' ? payload.scope.split(' ') : [];

      for (const required of this.config.requiredScopes) {
        if (!tokenScopes.includes(required)) {
          throw new OIDCAuthenticationError(`Missing required scope: ${required}`, 'INSUFFICIENT_SCOPE', 403);
        }
      }

      const principal: AuthenticatedPrincipal = {
        subject: payload.sub || '',
        email: (payload.email as string) || '',
        issuer: payload.iss || '',
        audience: typeof payload.aud === 'string' ? payload.aud : Array.isArray(payload.aud) ? payload.aud[0] : '',
        scopes: tokenScopes,
        claims: payload,
        authenticatedAt: new Date(),
      };

      logger.info('OIDC authentication successful', {
        subject: principal.subject,
        email: principal.email,
        issuer: principal.issuer,
      });

      return principal;
    } catch (error) {
      if (error instanceof OIDCAuthenticationError) throw error;

      const message = error instanceof Error ? error.message : String(error);
      logger.warn('OIDC authentication failed', { error: message });

      throw new OIDCAuthenticationError(`Token verification failed: ${message}`, 'INVALID_TOKEN');
    }
  }
}
```

- [ ] **Step 4: Install `jose` dependency**

Run: `npm install jose`

- [ ] **Step 5: Run the test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/auth/oidc-authenticator.test.ts --no-coverage`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add src/auth/oidc-authenticator.ts tests/unit/auth/oidc-authenticator.test.ts package.json package-lock.json
git commit -m "feat(auth): add generic OIDC authenticator with JWKS validation"
```

---

### Task 2: Authentication Middleware

**Files:**

- Create: `src/auth/auth-middleware.ts`
- Test: `tests/unit/auth/auth-middleware.test.ts`

This middleware extracts the bearer token from the MCP request metadata, validates it through the OIDC authenticator,
and attaches the `AuthenticatedPrincipal` to the request context. Following Google's pattern where each request carries
its own auth context (per the managed MCP servers blog: "agents inherit the permissions of the authenticated user").

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/auth/auth-middleware.test.ts
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { AuthMiddleware, AuthMiddlewareConfig } from '../../src/auth/auth-middleware.js';
import { AuthenticatedPrincipal } from '../../src/auth/oidc-authenticator.js';

// Mock OIDC authenticator
const mockAuthenticate = jest.fn<() => Promise<AuthenticatedPrincipal>>();

jest.unstable_mockModule('../../src/auth/oidc-authenticator.js', () => ({
  OIDCAuthenticator: jest.fn().mockImplementation(() => ({
    authenticate: mockAuthenticate,
  })),
  OIDCConfigSchema: { parse: (c: unknown) => c },
  OIDCAuthenticationError: class extends Error {
    code: string;
    statusCode: number;
    constructor(msg: string, code: string, status = 401) {
      super(msg);
      this.code = code;
      this.statusCode = status;
    }
  },
}));

describe('AuthMiddleware', () => {
  let middleware: AuthMiddleware;

  beforeEach(() => {
    jest.clearAllMocks();
    middleware = new AuthMiddleware({
      oidc: {
        issuer: 'https://accounts.google.com',
        audience: 'test-server',
      },
      bypassTools: [],
      requireAuth: true,
    });
  });

  it('rejects request without authorization header when requireAuth is true', async () => {
    const result = await middleware.authenticate({});
    expect(result.authenticated).toBe(false);
    expect(result.error).toContain('No authorization token');
  });

  it('passes through when requireAuth is false and no token provided', async () => {
    middleware = new AuthMiddleware({
      oidc: {
        issuer: 'https://accounts.google.com',
        audience: 'test-server',
      },
      bypassTools: [],
      requireAuth: false,
    });

    const result = await middleware.authenticate({});
    expect(result.authenticated).toBe(true);
    expect(result.principal).toBeUndefined();
  });

  it('authenticates valid token and returns principal', async () => {
    const mockPrincipal: AuthenticatedPrincipal = {
      subject: 'user-123',
      email: 'user@example.com',
      issuer: 'https://accounts.google.com',
      audience: 'test-server',
      scopes: ['bigquery.readonly'],
      claims: {},
      authenticatedAt: new Date(),
    };
    mockAuthenticate.mockResolvedValue(mockPrincipal);

    const result = await middleware.authenticate({
      authorization: 'Bearer valid-token',
    });

    expect(result.authenticated).toBe(true);
    expect(result.principal?.email).toBe('user@example.com');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/auth/auth-middleware.test.ts --no-coverage` Expected:
FAIL — module not found

- [ ] **Step 3: Implement AuthMiddleware**

```typescript
// src/auth/auth-middleware.ts
import { z } from 'zod';
import {
  OIDCAuthenticator,
  OIDCConfig,
  OIDCConfigSchema,
  AuthenticatedPrincipal,
  OIDCAuthenticationError,
} from './oidc-authenticator.js';
import { logger } from '../utils/logger.js';
import { recordAuthAttempt } from '../telemetry/metrics.js';

export const AuthMiddlewareConfigSchema = z.object({
  oidc: OIDCConfigSchema,
  bypassTools: z.array(z.string()).default([]),
  requireAuth: z.boolean().default(true),
});

export type AuthMiddlewareConfig = z.infer<typeof AuthMiddlewareConfigSchema>;

export interface AuthResult {
  authenticated: boolean;
  principal?: AuthenticatedPrincipal;
  error?: string;
  errorCode?: string;
}

export class AuthMiddleware {
  private authenticator: OIDCAuthenticator;
  private config: AuthMiddlewareConfig;

  constructor(config: AuthMiddlewareConfig) {
    this.config = AuthMiddlewareConfigSchema.parse(config);
    this.authenticator = new OIDCAuthenticator(this.config.oidc);
  }

  async authenticate(headers: Record<string, string | undefined>): Promise<AuthResult> {
    const token = headers.authorization || headers.Authorization;

    if (!token) {
      if (!this.config.requireAuth) {
        return { authenticated: true };
      }
      recordAuthAttempt(false);
      return {
        authenticated: false,
        error: 'No authorization token provided',
        errorCode: 'MISSING_TOKEN',
      };
    }

    try {
      const principal = await this.authenticator.authenticate(token);
      recordAuthAttempt(true);
      return { authenticated: true, principal };
    } catch (error) {
      recordAuthAttempt(false);
      if (error instanceof OIDCAuthenticationError) {
        return {
          authenticated: false,
          error: error.message,
          errorCode: error.code,
        };
      }
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Unexpected auth error', { error: message });
      return {
        authenticated: false,
        error: 'Authentication failed',
        errorCode: 'AUTH_ERROR',
      };
    }
  }

  isToolBypassed(toolName: string): boolean {
    return this.config.bypassTools.includes(toolName);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/auth/auth-middleware.test.ts --no-coverage` Expected:
PASS

- [ ] **Step 5: Commit**

```bash
git add src/auth/auth-middleware.ts tests/unit/auth/auth-middleware.test.ts
git commit -m "feat(auth): add auth middleware for MCP request pipeline"
```

---

## Phase 2: Multi-Tenant Isolation

### Task 3: Tenant Configuration Schema and Loader

**Files:**

- Create: `src/tenancy/tenant-config.ts`
- Create: `src/config/tenants.yaml`
- Test: `tests/unit/tenancy/tenant-config.test.ts`

This defines the tenant configuration format. Each tenant gets: an ID, allowed datasets, write mode, rate limits, and
OIDC provider mapping. Follows the `genai-toolbox` pattern where `tools.yaml` defines all resources declaratively with
`kind` discriminators and `allowedDatasets` restrictions.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/tenancy/tenant-config.test.ts
import { describe, it, expect } from '@jest/globals';
import {
  TenantConfigSchema,
  TenantsFileSchema,
  WriteMode,
  parseTenantConfig,
} from '../../src/tenancy/tenant-config.js';

describe('TenantConfig', () => {
  describe('TenantConfigSchema', () => {
    it('validates a complete tenant config', () => {
      const config = {
        id: 'acme-corp',
        name: 'Acme Corporation',
        projectId: 'acme-bq-prod',
        allowedDatasets: ['analytics', 'reporting'],
        deniedDatasets: [],
        writeMode: 'blocked' as const,
        maxBytesPerQuery: '10737418240', // 10 GB
        rateLimits: {
          requestsPerMinute: 60,
          queriesPerHour: 500,
        },
        oidcSubjectPattern: '.*@acme\\.com$',
      };
      const result = TenantConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('defaults writeMode to blocked', () => {
      const config = {
        id: 'test-tenant',
        name: 'Test',
        projectId: 'test-project',
        allowedDatasets: ['public'],
      };
      const result = TenantConfigSchema.parse(config);
      expect(result.writeMode).toBe('blocked');
    });

    it('rejects empty allowedDatasets when no deniedDatasets set', () => {
      const config = {
        id: 'test',
        name: 'Test',
        projectId: 'proj',
        allowedDatasets: [],
        deniedDatasets: [],
      };
      const result = TenantConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('accepts wildcard dataset access', () => {
      const config = {
        id: 'admin-tenant',
        name: 'Admin',
        projectId: 'proj',
        allowedDatasets: ['*'],
      };
      const result = TenantConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });
  });

  describe('parseTenantConfig', () => {
    it('parses a YAML config string', () => {
      const yaml = `
tenants:
  - id: acme
    name: Acme Corp
    projectId: acme-prod
    allowedDatasets:
      - analytics
    writeMode: blocked
    rateLimits:
      requestsPerMinute: 100
      queriesPerHour: 1000
    oidcSubjectPattern: ".*@acme\\\\.com$"
`;
      const result = parseTenantConfig(yaml);
      expect(result.tenants).toHaveLength(1);
      expect(result.tenants[0].id).toBe('acme');
      expect(result.tenants[0].writeMode).toBe('blocked');
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/tenancy/tenant-config.test.ts --no-coverage` Expected:
FAIL

- [ ] **Step 3: Implement TenantConfig**

```typescript
// src/tenancy/tenant-config.ts
import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import { logger } from '../utils/logger.js';

export enum WriteMode {
  BLOCKED = 'blocked',
  PROTECTED = 'protected',
  ALLOWED = 'allowed',
}

export const TenantConfigSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .regex(/^[a-z0-9-]+$/, 'Tenant ID must be lowercase alphanumeric with hyphens'),
    name: z.string().min(1),
    projectId: z.string().min(1),
    allowedDatasets: z.array(z.string()).min(1, 'At least one dataset must be allowed (use "*" for all)'),
    deniedDatasets: z.array(z.string()).default([]),
    writeMode: z.nativeEnum(WriteMode).default(WriteMode.BLOCKED),
    maxBytesPerQuery: z.string().optional(), // BigQuery maximumBytesBilled
    rateLimits: z
      .object({
        requestsPerMinute: z.number().min(1).default(100),
        queriesPerHour: z.number().min(1).default(1000),
      })
      .default({}),
    oidcSubjectPattern: z.string().optional(), // Regex to match JWT sub/email claims
    allowedTools: z.array(z.string()).optional(), // If set, only these tools available
  })
  .refine((data) => data.allowedDatasets.length > 0 || data.deniedDatasets.length > 0, {
    message: 'Must specify allowedDatasets or deniedDatasets',
  });

export type TenantConfig = z.infer<typeof TenantConfigSchema>;

export const TenantsFileSchema = z.object({
  tenants: z.array(TenantConfigSchema).min(1),
});

export type TenantsFile = z.infer<typeof TenantsFileSchema>;

export function parseTenantConfig(yamlContent: string): TenantsFile {
  const raw = parseYaml(yamlContent) as unknown;
  const result = TenantsFileSchema.parse(raw);

  // Validate no duplicate tenant IDs
  const ids = result.tenants.map((t) => t.id);
  const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (duplicates.length > 0) {
    throw new Error(`Duplicate tenant IDs: ${duplicates.join(', ')}`);
  }

  logger.info('Parsed tenant config', { tenantCount: result.tenants.length });
  return result;
}
```

- [ ] **Step 4: Install yaml dependency**

Run: `npm install yaml`

- [ ] **Step 5: Run tests**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/tenancy/tenant-config.test.ts --no-coverage` Expected:
PASS

- [ ] **Step 6: Create initial tenants.yaml**

```yaml
# src/config/tenants.yaml
# Tenant configuration for the BigQuery MCP Server.
# Each tenant defines an isolated access boundary for a customer.
#
# writeMode:
#   blocked   - No DML/DDL allowed (default, recommended for analytics)
#   protected - Writes go to temporary BigQuery sessions only
#   allowed   - Full write access (use with extreme caution)

tenants:
  - id: default
    name: Default Tenant
    projectId: ${GCP_PROJECT_ID}
    allowedDatasets:
      - '*'
    writeMode: blocked
    rateLimits:
      requestsPerMinute: 100
      queriesPerHour: 1000
```

- [ ] **Step 7: Commit**

```bash
git add src/tenancy/tenant-config.ts src/config/tenants.yaml tests/unit/tenancy/tenant-config.test.ts package.json package-lock.json
git commit -m "feat(tenancy): add tenant config schema and YAML parser"
```

---

### Task 4: Tenant Registry with Hot-Reload

**Files:**

- Create: `src/tenancy/tenant-registry.ts`
- Test: `tests/unit/tenancy/tenant-registry.test.ts`

The registry loads tenants from YAML at startup and watches the file for changes. This matches the `genai-toolbox`
pattern of dynamic config reloading (`--disable-reload` to turn off).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/tenancy/tenant-registry.test.ts
import { describe, it, expect, beforeEach } from '@jest/globals';
import { TenantRegistry } from '../../src/tenancy/tenant-registry.js';
import { TenantConfig, WriteMode } from '../../src/tenancy/tenant-config.js';

const testTenant: TenantConfig = {
  id: 'acme',
  name: 'Acme Corp',
  projectId: 'acme-prod',
  allowedDatasets: ['analytics'],
  deniedDatasets: [],
  writeMode: WriteMode.BLOCKED,
  rateLimits: { requestsPerMinute: 60, queriesPerHour: 500 },
  oidcSubjectPattern: '.*@acme\\.com$',
};

describe('TenantRegistry', () => {
  let registry: TenantRegistry;

  beforeEach(() => {
    registry = new TenantRegistry();
  });

  it('registers and retrieves a tenant by ID', () => {
    registry.register(testTenant);
    const tenant = registry.get('acme');
    expect(tenant).toBeDefined();
    expect(tenant!.projectId).toBe('acme-prod');
  });

  it('returns undefined for unknown tenant', () => {
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('resolves tenant from email using oidcSubjectPattern', () => {
    registry.register(testTenant);
    const tenant = registry.resolveBySubject('alice@acme.com');
    expect(tenant).toBeDefined();
    expect(tenant!.id).toBe('acme');
  });

  it('returns undefined when no tenant matches subject', () => {
    registry.register(testTenant);
    expect(registry.resolveBySubject('bob@other.com')).toBeUndefined();
  });

  it('lists all registered tenants', () => {
    registry.register(testTenant);
    registry.register({ ...testTenant, id: 'beta', oidcSubjectPattern: '.*@beta\\.com$' });
    expect(registry.list()).toHaveLength(2);
  });

  it('replaces tenant on re-register (hot-reload)', () => {
    registry.register(testTenant);
    registry.register({ ...testTenant, allowedDatasets: ['analytics', 'billing'] });
    const tenant = registry.get('acme');
    expect(tenant!.allowedDatasets).toEqual(['analytics', 'billing']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/tenancy/tenant-registry.test.ts --no-coverage`
Expected: FAIL

- [ ] **Step 3: Implement TenantRegistry**

```typescript
// src/tenancy/tenant-registry.ts
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
    // Clear and reload all tenants
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
```

- [ ] **Step 4: Run tests**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/tenancy/tenant-registry.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tenancy/tenant-registry.ts tests/unit/tenancy/tenant-registry.test.ts
git commit -m "feat(tenancy): add tenant registry with hot-reload support"
```

---

### Task 5: Dataset Access Policy Enforcement

**Files:**

- Create: `src/tenancy/dataset-policy.ts`
- Test: `tests/unit/tenancy/dataset-policy.test.ts`

This is the core security control: before any BigQuery operation, the dataset policy checks whether the tenant is
allowed to access the requested dataset. Implements the `allowedDatasets` / `deniedDatasets` pattern from Google's
`genai-toolbox` and the write-mode controls (`blocked`/`protected`/`allowed`).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/tenancy/dataset-policy.test.ts
import { describe, it, expect } from '@jest/globals';
import { DatasetPolicy } from '../../src/tenancy/dataset-policy.js';
import { TenantConfig, WriteMode } from '../../src/tenancy/tenant-config.js';

const makeTenant = (overrides: Partial<TenantConfig> = {}): TenantConfig => ({
  id: 'test',
  name: 'Test',
  projectId: 'proj',
  allowedDatasets: ['analytics', 'reporting'],
  deniedDatasets: [],
  writeMode: WriteMode.BLOCKED,
  rateLimits: { requestsPerMinute: 100, queriesPerHour: 1000 },
  ...overrides,
});

describe('DatasetPolicy', () => {
  it('allows access to an allowed dataset', () => {
    const policy = new DatasetPolicy(makeTenant());
    expect(policy.canAccessDataset('analytics')).toBe(true);
  });

  it('denies access to a non-allowed dataset', () => {
    const policy = new DatasetPolicy(makeTenant());
    expect(policy.canAccessDataset('secrets')).toBe(false);
  });

  it('allows all datasets with wildcard', () => {
    const policy = new DatasetPolicy(makeTenant({ allowedDatasets: ['*'] }));
    expect(policy.canAccessDataset('anything')).toBe(true);
  });

  it('denies explicitly denied datasets even with wildcard', () => {
    const policy = new DatasetPolicy(
      makeTenant({
        allowedDatasets: ['*'],
        deniedDatasets: ['pii_data'],
      })
    );
    expect(policy.canAccessDataset('pii_data')).toBe(false);
    expect(policy.canAccessDataset('analytics')).toBe(true);
  });

  it('blocks write queries when writeMode is blocked', () => {
    const policy = new DatasetPolicy(makeTenant({ writeMode: WriteMode.BLOCKED }));
    expect(policy.canWrite()).toBe(false);
  });

  it('allows write queries when writeMode is allowed', () => {
    const policy = new DatasetPolicy(makeTenant({ writeMode: WriteMode.ALLOWED }));
    expect(policy.canWrite()).toBe(true);
  });

  it('detects DML statements', () => {
    const policy = new DatasetPolicy(makeTenant());
    expect(policy.isDMLQuery('INSERT INTO t VALUES (1)')).toBe(true);
    expect(policy.isDMLQuery('UPDATE t SET x = 1')).toBe(true);
    expect(policy.isDMLQuery('DELETE FROM t WHERE id = 1')).toBe(true);
    expect(policy.isDMLQuery('MERGE INTO t USING s ON ...')).toBe(true);
    expect(policy.isDMLQuery('SELECT * FROM t')).toBe(false);
  });

  it('detects DDL statements', () => {
    const policy = new DatasetPolicy(makeTenant());
    expect(policy.isDDLQuery('CREATE TABLE t (id INT64)')).toBe(true);
    expect(policy.isDDLQuery('DROP TABLE t')).toBe(true);
    expect(policy.isDDLQuery('ALTER TABLE t ADD COLUMN x STRING')).toBe(true);
    expect(policy.isDDLQuery('SELECT 1')).toBe(false);
  });

  it('validates query against tenant policy', () => {
    const policy = new DatasetPolicy(makeTenant());
    const readResult = policy.validateQuery('SELECT * FROM `proj.analytics.events`');
    expect(readResult.allowed).toBe(true);

    const writeResult = policy.validateQuery('INSERT INTO `proj.analytics.events` VALUES (1)');
    expect(writeResult.allowed).toBe(false);
    expect(writeResult.reason).toContain('write');
  });

  it('extracts dataset references from query', () => {
    const policy = new DatasetPolicy(makeTenant());
    const datasets = policy.extractDatasetReferences(
      'SELECT a.*, b.* FROM `proj.analytics.events` a JOIN `proj.reporting.summary` b ON a.id = b.id'
    );
    expect(datasets).toContain('analytics');
    expect(datasets).toContain('reporting');
  });

  it('rejects query referencing unauthorized dataset', () => {
    const policy = new DatasetPolicy(makeTenant({ allowedDatasets: ['analytics'] }));
    const result = policy.validateQuery('SELECT * FROM `proj.secrets.passwords`');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('secrets');
  });

  it('enforces maxBytesPerQuery', () => {
    const policy = new DatasetPolicy(makeTenant({ maxBytesPerQuery: '1073741824' }));
    expect(policy.getMaxBytesBilled()).toBe('1073741824');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/tenancy/dataset-policy.test.ts --no-coverage` Expected:
FAIL

- [ ] **Step 3: Implement DatasetPolicy**

```typescript
// src/tenancy/dataset-policy.ts
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
    // Deny list takes precedence
    if (this.deniedSet.has(datasetId)) {
      return false;
    }
    // Wildcard allows everything not denied
    if (this.allowAll) {
      return true;
    }
    return this.allowedSet.has(datasetId);
  }

  canWrite(): boolean {
    return this.tenant.writeMode === WriteMode.ALLOWED || this.tenant.writeMode === WriteMode.PROTECTED;
  }

  isDMLQuery(query: string): boolean {
    const normalized = query.trim().toUpperCase();
    return /^\s*(INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|MERGE\s+INTO)\b/i.test(normalized);
  }

  isDDLQuery(query: string): boolean {
    const normalized = query.trim().toUpperCase();
    return /^\s*(CREATE\s+|DROP\s+|ALTER\s+|TRUNCATE\s+)\b/i.test(normalized);
  }

  extractDatasetReferences(query: string): string[] {
    // Match `project.dataset.table` or `dataset.table` backtick patterns
    const backtickPattern = /`(?:[\w-]+\.)?([\w-]+)\.[\w-]+`/g;
    const datasets = new Set<string>();
    let match: RegExpExecArray | null;

    while ((match = backtickPattern.exec(query)) !== null) {
      datasets.add(match[1]);
    }

    // Also match unquoted project.dataset.table references
    const unquotedPattern = /(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+(?:[\w-]+\.)?([\w-]+)\.[\w-]+/gi;
    while ((match = unquotedPattern.exec(query)) !== null) {
      datasets.add(match[1]);
    }

    return Array.from(datasets);
  }

  validateQuery(query: string): QueryValidationResult {
    const isWrite = this.isDMLQuery(query) || this.isDDLQuery(query);
    const datasetsAccessed = this.extractDatasetReferences(query);

    // Check write permission
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

    // Check dataset access
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
```

- [ ] **Step 4: Run tests**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/tenancy/dataset-policy.test.ts --no-coverage` Expected:
PASS

- [ ] **Step 5: Commit**

```bash
git add src/tenancy/dataset-policy.ts tests/unit/tenancy/dataset-policy.test.ts
git commit -m "feat(tenancy): add dataset access policy enforcement with write-mode controls"
```

---

### Task 6: Tenant Context (Per-Request Isolation)

**Files:**

- Create: `src/tenancy/tenant-context.ts`
- Test: `tests/unit/tenancy/tenant-context.test.ts`

The tenant context is constructed per-request by resolving the authenticated principal to a tenant and building a
`DatasetPolicy`. It carries the principal, tenant config, and policy through the request lifecycle.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/tenancy/tenant-context.test.ts
import { describe, it, expect, beforeEach } from '@jest/globals';
import { TenantContextFactory } from '../../src/tenancy/tenant-context.js';
import { TenantRegistry } from '../../src/tenancy/tenant-registry.js';
import { WriteMode } from '../../src/tenancy/tenant-config.js';
import { AuthenticatedPrincipal } from '../../src/auth/oidc-authenticator.js';

describe('TenantContextFactory', () => {
  let registry: TenantRegistry;
  let factory: TenantContextFactory;

  beforeEach(() => {
    registry = new TenantRegistry();
    registry.register({
      id: 'acme',
      name: 'Acme',
      projectId: 'acme-prod',
      allowedDatasets: ['analytics'],
      deniedDatasets: [],
      writeMode: WriteMode.BLOCKED,
      rateLimits: { requestsPerMinute: 60, queriesPerHour: 500 },
      oidcSubjectPattern: '.*@acme\\.com$',
    });
    factory = new TenantContextFactory(registry, 'default');
  });

  it('creates tenant context from authenticated principal', () => {
    const principal: AuthenticatedPrincipal = {
      subject: 'user-1',
      email: 'alice@acme.com',
      issuer: 'https://accounts.google.com',
      audience: 'mcp-server',
      scopes: [],
      claims: {},
      authenticatedAt: new Date(),
    };

    const ctx = factory.createContext(principal);
    expect(ctx.tenantId).toBe('acme');
    expect(ctx.projectId).toBe('acme-prod');
    expect(ctx.policy.canAccessDataset('analytics')).toBe(true);
    expect(ctx.policy.canAccessDataset('secrets')).toBe(false);
  });

  it('falls back to default tenant when no pattern matches', () => {
    registry.register({
      id: 'default',
      name: 'Default',
      projectId: 'default-proj',
      allowedDatasets: ['public'],
      deniedDatasets: [],
      writeMode: WriteMode.BLOCKED,
      rateLimits: { requestsPerMinute: 10, queriesPerHour: 100 },
    });

    const principal: AuthenticatedPrincipal = {
      subject: 'user-2',
      email: 'bob@unknown.com',
      issuer: 'https://accounts.google.com',
      audience: 'mcp-server',
      scopes: [],
      claims: {},
      authenticatedAt: new Date(),
    };

    const ctx = factory.createContext(principal);
    expect(ctx.tenantId).toBe('default');
  });

  it('throws when no tenant matches and no default exists', () => {
    const noDefaultFactory = new TenantContextFactory(new TenantRegistry(), 'default');
    const principal: AuthenticatedPrincipal = {
      subject: 'user-3',
      email: 'charlie@nowhere.com',
      issuer: 'https://accounts.google.com',
      audience: 'mcp-server',
      scopes: [],
      claims: {},
      authenticatedAt: new Date(),
    };

    expect(() => noDefaultFactory.createContext(principal)).toThrow('No tenant found');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/tenancy/tenant-context.test.ts --no-coverage` Expected:
FAIL

- [ ] **Step 3: Implement TenantContextFactory**

```typescript
// src/tenancy/tenant-context.ts
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
    // Try to resolve tenant from email or subject
    let tenant = this.registry.resolveBySubject(principal.email) || this.registry.resolveBySubject(principal.subject);

    // Fall back to default tenant
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
```

- [ ] **Step 4: Run tests**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/tenancy/tenant-context.test.ts --no-coverage` Expected:
PASS

- [ ] **Step 5: Commit**

```bash
git add src/tenancy/tenant-context.ts tests/unit/tenancy/tenant-context.test.ts
git commit -m "feat(tenancy): add per-request tenant context factory"
```

---

## Phase 3: MCP Protocol Enhancements

### Task 7: MCP Tool Annotations

**Files:**

- Create: `src/mcp/tools/annotations.ts`
- Modify: `src/mcp/tools/definitions.ts`
- Test: `tests/unit/mcp/annotations.test.ts`

The MCP specification defines tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`)
that inform the client about tool behavior. Google's `genai-toolbox` uses `NewReadOnlyAnnotations()` and
`NewDestructiveAnnotations()` helpers. This is critical for enterprise safety.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/mcp/annotations.test.ts
import { describe, it, expect } from '@jest/globals';
import { readOnlyAnnotations, destructiveAnnotations, getToolAnnotations } from '../../src/mcp/tools/annotations.js';

describe('Tool Annotations', () => {
  it('returns read-only annotations for query_bigquery', () => {
    const annotations = getToolAnnotations('query_bigquery');
    expect(annotations.readOnlyHint).toBe(true);
    expect(annotations.destructiveHint).toBe(false);
  });

  it('returns read-only annotations for list_datasets', () => {
    const annotations = getToolAnnotations('list_datasets');
    expect(annotations.readOnlyHint).toBe(true);
  });

  it('returns read-only annotations for list_tables', () => {
    const annotations = getToolAnnotations('list_tables');
    expect(annotations.readOnlyHint).toBe(true);
  });

  it('returns read-only annotations for get_table_schema', () => {
    const annotations = getToolAnnotations('get_table_schema');
    expect(annotations.readOnlyHint).toBe(true);
    expect(annotations.idempotentHint).toBe(true);
  });

  it('readOnlyAnnotations helper returns correct shape', () => {
    const ann = readOnlyAnnotations();
    expect(ann).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it('destructiveAnnotations helper returns correct shape', () => {
    const ann = destructiveAnnotations();
    expect(ann).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/mcp/annotations.test.ts --no-coverage` Expected: FAIL

- [ ] **Step 3: Implement annotations**

```typescript
// src/mcp/tools/annotations.ts

export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export function readOnlyAnnotations(): ToolAnnotations {
  return {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
}

export function destructiveAnnotations(): ToolAnnotations {
  return {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  };
}

const TOOL_ANNOTATIONS: Record<string, ToolAnnotations> = {
  query_bigquery: { ...readOnlyAnnotations(), idempotentHint: false }, // queries can have side effects via UDFs
  execute_query: { ...readOnlyAnnotations(), idempotentHint: false },
  list_datasets: readOnlyAnnotations(),
  list_tables: readOnlyAnnotations(),
  get_table_schema: readOnlyAnnotations(),
};

export function getToolAnnotations(toolName: string): ToolAnnotations {
  return TOOL_ANNOTATIONS[toolName] || readOnlyAnnotations();
}
```

- [ ] **Step 4: Run tests**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/mcp/annotations.test.ts --no-coverage` Expected: PASS

- [ ] **Step 5: Update tool definitions to include annotations**

Modify `src/mcp/tools/definitions.ts:6-35`:

```typescript
import { zodToJsonSchema } from 'zod-to-json-schema';
import { z } from 'zod';
import { TOOL_SCHEMAS } from '../schemas/tool-schemas.js';
import { OUTPUT_SCHEMAS } from '../schemas/output-schemas.js';
import { getToolAnnotations, ToolAnnotations } from './annotations.js';

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: unknown;
  outputSchema?: unknown;
  annotations?: ToolAnnotations;
}

export function generateToolDefinitions(getDescription: (name: string) => string): ToolDefinition[] {
  const entries = Object.entries(TOOL_SCHEMAS) as [string, z.ZodTypeAny][];

  return entries.map(([name, schema]) => {
    // @ts-expect-error: Type instantiation is excessively deep
    const inputSchema = zodToJsonSchema(schema, { target: 'jsonSchema7' });
    const outputZod = OUTPUT_SCHEMAS[name as keyof typeof OUTPUT_SCHEMAS] as z.ZodTypeAny | undefined;
    const outputSchema = outputZod ? zodToJsonSchema(outputZod, { target: 'jsonSchema7' }) : undefined;
    const description = getDescription(name);
    return {
      name,
      title: description,
      description,
      inputSchema,
      outputSchema,
      annotations: getToolAnnotations(name),
    };
  });
}
```

- [ ] **Step 6: Run full test suite to ensure no regressions**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest --no-coverage` Expected: All existing tests pass

- [ ] **Step 7: Commit**

```bash
git add src/mcp/tools/annotations.ts src/mcp/tools/definitions.ts tests/unit/mcp/annotations.test.ts
git commit -m "feat(mcp): add MCP tool annotations (readOnly, destructive hints)"
```

---

## Phase 4: Wire Auth + Tenancy into Request Pipeline

### Task 8: Integrate Auth and Tenant Context into Tool Execution

**Files:**

- Modify: `src/index.ts:107-157` (constructor), `src/index.ts:325-505` (CallToolRequestSchema handler)
- Modify: `src/mcp/handlers/tool-handlers.ts:39-44` (ToolHandlerContext)
- Test: `tests/integration/tenant-isolation.test.ts`

This is the critical integration task. The CallTool handler must:

1. Extract auth token from request metadata
2. Authenticate via OIDC
3. Resolve tenant from principal
4. Build tenant context with dataset policy
5. Pass tenant context into tool handlers
6. Enforce dataset policy on every query
7. Apply per-tenant rate limits and maxBytesBilled

- [ ] **Step 1: Write the integration test**

```typescript
// tests/integration/tenant-isolation.test.ts
import { describe, it, expect, beforeEach } from '@jest/globals';
import { DatasetPolicy } from '../../src/tenancy/dataset-policy.js';
import { TenantRegistry } from '../../src/tenancy/tenant-registry.js';
import { TenantContextFactory } from '../../src/tenancy/tenant-context.js';
import { WriteMode } from '../../src/tenancy/tenant-config.js';
import { AuthenticatedPrincipal } from '../../src/auth/oidc-authenticator.js';

describe('Tenant Isolation Integration', () => {
  let registry: TenantRegistry;
  let factory: TenantContextFactory;

  beforeEach(() => {
    registry = new TenantRegistry();

    registry.register({
      id: 'tenant-a',
      name: 'Tenant A',
      projectId: 'proj-a',
      allowedDatasets: ['analytics'],
      deniedDatasets: [],
      writeMode: WriteMode.BLOCKED,
      rateLimits: { requestsPerMinute: 60, queriesPerHour: 500 },
      oidcSubjectPattern: '.*@tenant-a\\.com$',
      maxBytesPerQuery: '1073741824',
    });

    registry.register({
      id: 'tenant-b',
      name: 'Tenant B',
      projectId: 'proj-b',
      allowedDatasets: ['sales', 'inventory'],
      deniedDatasets: [],
      writeMode: WriteMode.ALLOWED,
      rateLimits: { requestsPerMinute: 120, queriesPerHour: 2000 },
      oidcSubjectPattern: '.*@tenant-b\\.com$',
    });

    factory = new TenantContextFactory(registry, 'default');
  });

  it('isolates tenant A to analytics dataset only', () => {
    const principal: AuthenticatedPrincipal = {
      subject: 'u1',
      email: 'user@tenant-a.com',
      issuer: 'https://idp.com',
      audience: 'mcp',
      scopes: [],
      claims: {},
      authenticatedAt: new Date(),
    };
    const ctx = factory.createContext(principal);

    expect(ctx.policy.canAccessDataset('analytics')).toBe(true);
    expect(ctx.policy.canAccessDataset('sales')).toBe(false);
    expect(ctx.policy.canWrite()).toBe(false);
  });

  it('allows tenant B to access sales and inventory with writes', () => {
    const principal: AuthenticatedPrincipal = {
      subject: 'u2',
      email: 'user@tenant-b.com',
      issuer: 'https://idp.com',
      audience: 'mcp',
      scopes: [],
      claims: {},
      authenticatedAt: new Date(),
    };
    const ctx = factory.createContext(principal);

    expect(ctx.policy.canAccessDataset('sales')).toBe(true);
    expect(ctx.policy.canAccessDataset('inventory')).toBe(true);
    expect(ctx.policy.canAccessDataset('analytics')).toBe(false);
    expect(ctx.policy.canWrite()).toBe(true);
  });

  it('tenant A cannot query tenant B datasets', () => {
    const principal: AuthenticatedPrincipal = {
      subject: 'u1',
      email: 'user@tenant-a.com',
      issuer: 'https://idp.com',
      audience: 'mcp',
      scopes: [],
      claims: {},
      authenticatedAt: new Date(),
    };
    const ctx = factory.createContext(principal);
    const result = ctx.policy.validateQuery('SELECT * FROM `proj-b.sales.orders`');

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('sales');
  });

  it('tenant A query within allowed dataset passes validation', () => {
    const principal: AuthenticatedPrincipal = {
      subject: 'u1',
      email: 'user@tenant-a.com',
      issuer: 'https://idp.com',
      audience: 'mcp',
      scopes: [],
      claims: {},
      authenticatedAt: new Date(),
    };
    const ctx = factory.createContext(principal);
    const result = ctx.policy.validateQuery('SELECT * FROM `proj-a.analytics.events`');

    expect(result.allowed).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify test passes (tests existing modules in integration)**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/integration/tenant-isolation.test.ts --no-coverage`
Expected: PASS (this tests the already-built modules together)

- [ ] **Step 3: Update ToolHandlerContext to include tenant context**

In `src/mcp/handlers/tool-handlers.ts`, update the `ToolHandlerContext` interface (lines 39-44):

```typescript
import { TenantContext } from '../../tenancy/tenant-context.js';

export interface ToolHandlerContext {
  bigQueryClient: BigQueryClient;
  userId?: string;
  requestId?: string;
  metadata?: ToolRequestMetadata;
  tenantContext?: TenantContext; // NEW: per-request tenant isolation
}
```

- [ ] **Step 4: Update QueryBigQueryHandler to enforce dataset policy**

In `src/mcp/handlers/tool-handlers.ts`, update `QueryBigQueryHandler.execute()` (lines 146-204):

```typescript
export class QueryBigQueryHandler extends BaseToolHandler {
  async execute(args: unknown): Promise<ToolResponse> {
    try {
      const validated = validateToolArgs('query_bigquery', args);
      const { query, dryRun, maxResults, timeoutMs, useLegacySql, location } = validated;

      // Enforce tenant dataset policy
      if (this.context.tenantContext) {
        const policyResult = this.context.tenantContext.policy.validateQuery(query);
        if (!policyResult.allowed) {
          logger.warn('Query blocked by tenant policy', {
            tenant: this.context.tenantContext.tenantId,
            reason: policyResult.reason,
            requestId: this.context.requestId,
          });
          return this.formatError(
            policyResult.reason || 'Query not allowed by tenant policy',
            'TENANT_POLICY_VIOLATION'
          );
        }
      }

      logger.info('Executing BigQuery query', {
        queryLength: query.length,
        dryRun,
        requestId: this.context.requestId,
        tenant: this.context.tenantContext?.tenantId,
      });

      // Apply per-tenant maxBytesBilled
      const maxBytesBilled = this.context.tenantContext?.policy.getMaxBytesBilled();

      if (dryRun) {
        const dryRunResult = await this.context.bigQueryClient.dryRun(query, {
          useLegacySql,
          location,
        });
        return this.formatSuccess({
          dryRun: true,
          totalBytesProcessed: dryRunResult.totalBytesProcessed,
          estimatedCostUSD: dryRunResult.estimatedCostUSD,
        });
      }

      const result = await this.context.bigQueryClient.query({
        query,
        maxResults,
        jobTimeoutMs: timeoutMs,
        useLegacySql,
        location,
        maximumBytesBilled: maxBytesBilled,
      });

      if (result.rows.length > 1000) {
        return this.formatStreamingResponse(result.rows as QueryRow[], {
          totalRows: result.totalRows,
          jobId: result.jobId,
          cacheHit: result.cacheHit,
          executionTimeMs: result.executionTimeMs,
          totalBytesProcessed: result.totalBytesProcessed,
        });
      }

      return this.formatSuccess({
        rowCount: result.rows.length,
        rows: result.rows,
        schema: result.schema,
        jobId: result.jobId,
        cacheHit: result.cacheHit,
        executionTimeMs: result.executionTimeMs,
        totalBytesProcessed: result.totalBytesProcessed,
      });
    } catch (error) {
      return this.formatError(error as Error, 'QUERY_ERROR');
    }
  }
}
```

- [ ] **Step 5: Run full test suite**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest --no-coverage` Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/mcp/handlers/tool-handlers.ts tests/integration/tenant-isolation.test.ts
git commit -m "feat(tenancy): wire tenant context and dataset policy into tool execution pipeline"
```

---

## Phase 5: HTTP Transport for Remote Access

### Task 9: Streamable HTTP Transport

**Files:**

- Create: `src/mcp/transports/http-transport.ts`
- Modify: `src/mcp/server-factory.ts:189-209`
- Modify: `src/config/environment.ts`
- Test: `tests/unit/mcp/http-transport.test.ts`

Currently the server only supports stdio transport (local process). For enterprise deployment on Cloud Run, customers
need an HTTP endpoint. The MCP spec supports Streamable HTTP transport. Google's managed MCP servers all use HTTP
endpoints.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/mcp/http-transport.test.ts
import { describe, it, expect } from '@jest/globals';
import { HttpTransportConfigSchema } from '../../src/mcp/transports/http-transport.js';

describe('HttpTransport', () => {
  describe('HttpTransportConfigSchema', () => {
    it('validates a valid HTTP config', () => {
      const config = {
        port: 8080,
        host: '0.0.0.0',
        basePath: '/mcp',
        corsOrigins: ['https://example.com'],
      };
      const result = HttpTransportConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('defaults port to 8080', () => {
      const config = {};
      const result = HttpTransportConfigSchema.parse(config);
      expect(result.port).toBe(8080);
    });

    it('defaults host to 0.0.0.0', () => {
      const config = {};
      const result = HttpTransportConfigSchema.parse(config);
      expect(result.host).toBe('0.0.0.0');
    });

    it('rejects port 0', () => {
      const config = { port: 0 };
      const result = HttpTransportConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/mcp/http-transport.test.ts --no-coverage` Expected:
FAIL

- [ ] **Step 3: Implement HttpTransport config**

```typescript
// src/mcp/transports/http-transport.ts
import { z } from 'zod';
import express, { Request, Response, NextFunction } from 'express';
import { logger } from '../../utils/logger.js';

export const HttpTransportConfigSchema = z.object({
  port: z.number().min(1).max(65535).default(8080),
  host: z.string().default('0.0.0.0'),
  basePath: z.string().default('/mcp'),
  corsOrigins: z.array(z.string()).default(['*']),
  requestTimeoutMs: z.number().default(300000), // 5 minutes
  maxRequestBodyBytes: z.number().default(1048576), // 1 MB
});

export type HttpTransportConfig = z.infer<typeof HttpTransportConfigSchema>;

export function createHttpApp(config: HttpTransportConfig): express.Application {
  const app = express();

  // Security headers
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });

  // CORS
  app.use((_req: Request, res: Response, next: NextFunction) => {
    const origin = _req.headers.origin;
    if (origin && (config.corsOrigins.includes('*') || config.corsOrigins.includes(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Max-Age', '86400');
    }
    if (_req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  // Body parser with size limit
  app.use(express.json({ limit: config.maxRequestBodyBytes }));

  // Health endpoints (outside auth)
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
  });

  app.get('/readiness', (_req: Request, res: Response) => {
    res.json({ ready: true, timestamp: new Date().toISOString() });
  });

  logger.info('HTTP transport app created', {
    basePath: config.basePath,
    port: config.port,
  });

  return app;
}
```

- [ ] **Step 4: Run tests**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/mcp/http-transport.test.ts --no-coverage` Expected:
PASS

- [ ] **Step 5: Add HTTP transport settings to environment config**

In `src/config/environment.ts`, add to the `EnvironmentSchema` (after BIGQUERY_TIMEOUT):

```typescript
  // Transport
  MCP_TRANSPORT: z.enum(['stdio', 'http']).default('stdio'),
  MCP_HTTP_PORT: z.string().transform(Number).default('8080'),

  // Tenancy
  TENANT_CONFIG_PATH: z.string().default('./src/config/tenants.yaml'),
  TENANT_HOT_RELOAD: z.string().transform(v => v === 'true').default('true'),
```

- [ ] **Step 6: Commit**

```bash
git add src/mcp/transports/http-transport.ts src/config/environment.ts tests/unit/mcp/http-transport.test.ts
git commit -m "feat(transport): add HTTP transport config and Express app for Cloud Run deployment"
```

---

## Phase 6: Operational Hardening

### Task 10: Persistent Audit Logging to Cloud Logging

**Files:**

- Modify: `src/auth/audit-logger.ts:520-534` (logToCloud method)

Currently the audit logger writes to Cloud Logging via the Winston logger, which is correct. However, audit events
should also be structured as Cloud Audit Log entries with the `protoPayload` format for integration with Cloud Audit
Logs and Security Command Center.

This task ensures audit events use the correct `jsonPayload.@type` for AuditLog entries so they appear in the GCP
Console under Activity > Data Access logs.

- [ ] **Step 1: Update the logToCloud method**

In `src/auth/audit-logger.ts`, update `logToCloud` (lines 520-534):

```typescript
  private logToCloud(event: AuditEvent): void {
    const logLevel = this.severityToLogLevel(event.severity);
    const logData = {
      // Structured audit payload for Cloud Audit Logs integration
      '@type': 'type.googleapis.com/google.cloud.audit.AuditLog',
      audit: true,
      eventType: event.eventType,
      severity: event.severity,
      principal: event.principal,
      principalType: event.principalType,
      action: event.action,
      resource: event.resource,
      outcome: event.outcome,
      projectId: event.projectId,
      datasetId: event.datasetId,
      tableId: event.tableId,
      ipAddress: event.ipAddress,
      userAgent: event.userAgent,
      sessionId: event.sessionId,
      durationMs: event.durationMs,
      bytesProcessed: event.bytesProcessed,
      ...event.metadata,
    };

    logger.log(logLevel, event.message, logData);
  }
```

- [ ] **Step 2: Run existing audit logger tests to verify no regressions**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/ --no-coverage` Expected: All pass

- [ ] **Step 3: Commit**

```bash
git add src/auth/audit-logger.ts
git commit -m "fix(audit): structure audit events as Cloud Audit Log entries for GCP integration"
```

---

### Task 11: Per-Tenant Rate Limiting

**Files:**

- Modify: `src/security/middleware.ts:91-162` (RateLimiter class)

Currently rate limiting uses `userId` or `anon:<toolName>` as the identifier. For multi-tenant operation, rate limiting
must be per-tenant with tenant-specific limits defined in `tenants.yaml`.

- [ ] **Step 1: Write the failing test**

```typescript
// In tests/unit/security-middleware.test.ts (add to existing file)
// Add a test that verifies tenant-aware rate limiting

describe('RateLimiter tenant-aware', () => {
  it('applies tenant-specific rate limits', () => {
    const config = SecurityConfigSchema.parse({
      rateLimitEnabled: true,
      rateLimitMaxRequests: 100, // default
    });
    const limiter = new RateLimiter(config);

    // Simulate tenant with lower limit
    const tenantLimit = 5;
    for (let i = 0; i < tenantLimit; i++) {
      const result = limiter.checkRateLimit('tenant:acme', tenantLimit);
      expect(result.allowed).toBe(true);
    }

    // Next request should be blocked
    const blocked = limiter.checkRateLimit('tenant:acme', tenantLimit);
    expect(blocked.allowed).toBe(false);
  });
});
```

- [ ] **Step 2: Update RateLimiter to accept per-call limit overrides**

In `src/security/middleware.ts`, update the `checkRateLimit` method (lines 105-142):

```typescript
  checkRateLimit(identifier: string, maxRequests?: number): { allowed: boolean; remaining: number } {
    if (!this.config.rateLimitEnabled) {
      return { allowed: true, remaining: this.config.rateLimitMaxRequests };
    }

    const effectiveMax = maxRequests ?? this.config.rateLimitMaxRequests;
    const now = Date.now();
    const entry = this.requests.get(identifier);

    if (!entry || now >= entry.resetTime) {
      this.requests.set(identifier, {
        count: 1,
        resetTime: now + this.config.rateLimitWindowMs,
      });
      return {
        allowed: true,
        remaining: effectiveMax - 1,
      };
    }

    if (entry.count >= effectiveMax) {
      logger.warn('Rate limit exceeded', {
        identifier,
        count: entry.count,
        limit: effectiveMax,
      });
      recordError('rate_limit_exceeded');
      return { allowed: false, remaining: 0 };
    }

    entry.count++;
    return {
      allowed: true,
      remaining: effectiveMax - entry.count,
    };
  }
```

- [ ] **Step 3: Run tests**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/security-middleware.test.ts --no-coverage` Expected:
PASS

- [ ] **Step 4: Commit**

```bash
git add src/security/middleware.ts tests/unit/security-middleware.test.ts
git commit -m "feat(security): support per-tenant rate limit overrides"
```

---

## Phase 7: Infrastructure Updates

### Task 12: Terraform Updates for Production Deployment

**Files:**

- Modify: `terraform/modules/cloud-run/main.tf`
- Modify: `terraform/variables.tf`

Update the Cloud Run configuration for HTTP ingress (currently only stdio), add Secret Manager for tenant configs, and
configure Cloud Armor WAF rules.

- [ ] **Step 1: Add HTTP container port and environment variables to Cloud Run module**

In `terraform/modules/cloud-run/main.tf`, ensure the Cloud Run service exposes port 8080 and includes the necessary env
vars:

```hcl
resource "google_cloud_run_v2_service" "mcp_server" {
  name     = "mcp-bigquery-server-${var.environment}"
  location = var.region
  project  = var.project_id

  template {
    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    containers {
      image = var.image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
      }

      env {
        name  = "MCP_TRANSPORT"
        value = "http"
      }

      env {
        name  = "MCP_HTTP_PORT"
        value = "8080"
      }

      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }

      env {
        name  = "NODE_ENV"
        value = var.environment
      }

      env {
        name  = "TENANT_CONFIG_PATH"
        value = "/config/tenants.yaml"
      }

      # Mount tenant config from Secret Manager
      volume_mounts {
        name       = "tenant-config"
        mount_path = "/config"
      }

      startup_probe {
        http_get {
          path = "/health"
          port = 8080
        }
        initial_delay_seconds = 5
        period_seconds        = 10
        failure_threshold     = 3
      }

      liveness_probe {
        http_get {
          path = "/health"
          port = 8080
        }
        period_seconds    = 30
        failure_threshold = 3
      }
    }

    volumes {
      name = "tenant-config"
      secret {
        secret  = google_secret_manager_secret.tenant_config.secret_id
        items {
          version = "latest"
          path    = "tenants.yaml"
        }
      }
    }

    service_account = var.service_account_email

    vpc_access {
      connector = var.vpc_connector_id
      egress    = "ALL_TRAFFIC"
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }
}

resource "google_secret_manager_secret" "tenant_config" {
  project   = var.project_id
  secret_id = "mcp-tenant-config-${var.environment}"

  replication {
    auto {}
  }
}
```

- [ ] **Step 2: Add new variables to `terraform/variables.tf`**

```hcl
variable "mcp_transport" {
  description = "MCP transport type (stdio or http)"
  type        = string
  default     = "http"
}
```

- [ ] **Step 3: Validate Terraform**

Run: `cd terraform && terraform validate` Expected: Success

- [ ] **Step 4: Commit**

```bash
git add terraform/
git commit -m "infra(terraform): update Cloud Run for HTTP transport, Secret Manager tenant config, health probes"
```

---

## Phase 8: Deployment and Operations Checklist

### Task 13: Docker and CI/CD Updates

**Files:**

- Modify: `Dockerfile`

- [ ] **Step 1: Update Dockerfile for production build**

```dockerfile
# Build stage
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --production=false
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Production stage
FROM node:22-alpine
WORKDIR /app

# Security: run as non-root
RUN addgroup -g 1001 -S mcp && adduser -S mcp -u 1001 -G mcp
USER mcp

COPY --from=builder --chown=mcp:mcp /app/dist ./dist
COPY --from=builder --chown=mcp:mcp /app/node_modules ./node_modules
COPY --from=builder --chown=mcp:mcp /app/package.json ./

# Default to HTTP transport for Cloud Run
ENV NODE_ENV=production
ENV MCP_TRANSPORT=http
ENV MCP_HTTP_PORT=8080

EXPOSE 8080

CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: Build Docker image**

Run: `docker build -t mcp-bigquery-server:latest .` Expected: Successful build

- [ ] **Step 3: Commit**

```bash
git add Dockerfile
git commit -m "infra(docker): multi-stage production build with non-root user"
```

---

## Operational Runbook Summary

After completing all tasks above, the system provides:

### Architecture

```
Customer Agent (Claude/Gemini/Custom)
       │
       │ HTTPS + Bearer Token
       ▼
┌─────────────────────────────────────┐
│         Cloud Run (HTTP MCP)        │
│  ┌───────────────────────────────┐  │
│  │    Auth Middleware (OIDC)      │  │ ← Validates JWT via JWKS
│  ├───────────────────────────────┤  │
│  │  Tenant Context Factory       │  │ ← Resolves principal → tenant
│  ├───────────────────────────────┤  │
│  │  Security Middleware          │  │ ← Rate limiting, injection detection
│  │  (per-tenant rate limits)     │  │
│  ├───────────────────────────────┤  │
│  │  Dataset Policy Enforcement   │  │ ← Allowlist/denylist per tenant
│  ├───────────────────────────────┤  │
│  │  MCP Tool Handlers            │  │ ← query, list, schema tools
│  │  (with annotations)           │  │
│  ├───────────────────────────────┤  │
│  │  BigQuery Client              │  │ ← Connection pool, retry, caching
│  │  (per-tenant project scope)   │  │
│  ├───────────────────────────────┤  │
│  │  Telemetry (OTel)             │  │ ← Traces → Cloud Trace
│  │  Audit Logger                 │  │ ← Events → Cloud Logging
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
       │                    │
       ▼                    ▼
   BigQuery             Cloud Monitoring
   (per-tenant          (dashboards,
    project)             alerts)
```

### Security Controls Summary

| Control             | Implementation                                      | Source Reference                     |
| ------------------- | --------------------------------------------------- | ------------------------------------ |
| Authentication      | OIDC JWT with JWKS caching                          | Google `genai-toolbox` generic auth  |
| Authorization       | Per-tenant dataset allowlist/denylist               | `genai-toolbox` `allowedDatasets`    |
| Write Protection    | Per-tenant writeMode (blocked/protected/allowed)    | `genai-toolbox` BigQuery write modes |
| Query Safety        | SQL injection detection, prompt injection detection | Existing `security/middleware.ts`    |
| Rate Limiting       | Per-tenant configurable limits                      | Google managed MCP IAM integration   |
| Cost Control        | Per-tenant `maximumBytesBilled`                     | BigQuery billing controls            |
| Data Redaction      | Sensitive field detection + auto-redaction          | Existing `SensitiveDataDetector`     |
| Tool Annotations    | MCP spec readOnly/destructive hints                 | `genai-toolbox` tool annotations     |
| Audit Trail         | Structured Cloud Audit Log entries                  | Google Cloud MCP audit logging       |
| Network Security    | VPC Service Controls, Cloud Armor WAF               | Existing Terraform modules           |
| Identity Federation | Workload Identity (keyless auth to GCP)             | Existing WIF module                  |
| Tenant Isolation    | Separate project + dataset scope per tenant         | Google managed MCP user-level auth   |

### Compliance Checklist

- [ ] **SOC 2**: Audit logging, access controls, encryption in transit (HTTPS), identity verification
- [ ] **GDPR**: Data residency (BigQuery location config), right to erasure (tenant deletion), data minimization
      (allowlist)
- [ ] **HIPAA**: Audit trail for PHI access, encryption, access controls, BAA with GCP
- [ ] **PCI DSS**: Sensitive data redaction (credit card patterns), network segmentation (VPC), access logging

### Scaling Considerations

| Parameter                | Recommended           | Configurable Via          |
| ------------------------ | --------------------- | ------------------------- |
| Cloud Run min instances  | 1 (avoid cold starts) | `terraform.tfvars`        |
| Cloud Run max instances  | 100                   | `terraform.tfvars`        |
| Connection pool min      | 2                     | `BigQueryClientConfig`    |
| Connection pool max      | 10 per instance       | `BigQueryClientConfig`    |
| Rate limit per tenant    | 100 req/min default   | `tenants.yaml`            |
| Query timeout            | 60s default           | `BIGQUERY_TIMEOUT` env    |
| Max bytes per query      | Unlimited by default  | `tenants.yaml` per tenant |
| Tenant config hot-reload | Enabled               | `TENANT_HOT_RELOAD` env   |

---

## Appendix: Key Decisions from Research

### Why OIDC over API Keys

Google's managed MCP servers documentation explicitly states: "Authentication handled entirely through IAM rather than
shared keys. No shared API keys or connection strings exposed to the agent." The `genai-toolbox` implements both
Google-specific and generic OIDC auth. OIDC provides: identity attribution (who did what), automatic key rotation via
JWKS, scope-based access control, and integration with all major identity providers.

### Why Tenant YAML over Database

Following the `genai-toolbox` `tools.yaml` pattern — declarative configuration that can be:

1. Version-controlled in git
2. Stored in Secret Manager for production
3. Hot-reloaded without restart
4. Validated at startup with Zod schemas

A database would add operational complexity (migration, backup, availability) for what is typically a slow-changing
configuration.

### Why Dataset Allowlists over Row-Level Security

BigQuery supports row-level and column-level security, but these are configured in BigQuery itself, not in the MCP
server. The MCP server's role is to enforce which datasets each tenant can see at all — a coarser-grained but critical
first defense. Row/column-level policies in BigQuery provide defense-in-depth and should be configured separately via
Terraform.

### Why Structured Query Templates (Future Phase)

The `genai-toolbox` strongly favors predefined SQL statements with parameterized inputs over arbitrary SQL execution.
This plan includes raw query access (matching the current codebase) but structured query templates should be a follow-up
phase for production deployments where customers should only run specific approved queries.
