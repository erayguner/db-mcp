# Workload Identity Federation Architecture

**Version**: 2.0.0
**Last Updated**: 2025-10-26
**Status**: REDESIGNED FOR ZERO-KEY AUTHENTICATION

---

## Executive Summary

This document defines the **Workload Identity Federation (WIF)** architecture for the BigQuery MCP Server, replacing all service account key-based authentication with keyless, short-lived credentials. This redesign eliminates the security risks of long-lived service account keys while providing seamless authentication across multiple deployment environments.

### Key Architectural Changes

| Aspect | Previous Architecture | WIF Architecture |
|--------|----------------------|------------------|
| **Authentication** | Service account JSON keys | Workload Identity Federation |
| **Credential Lifetime** | Indefinite (until rotated) | 1 hour maximum |
| **Key Storage** | File system, environment vars | No keys stored |
| **Rotation** | Manual (90-day policy) | Automatic (hourly) |
| **Cross-Platform** | Separate keys per platform | Unified identity pool |
| **Security Risk** | High (key exposure) | Minimal (ephemeral tokens) |

---

## 1. Workload Identity Federation Overview

### 1.1 What is Workload Identity Federation?

Workload Identity Federation allows applications running outside GCP to access Google Cloud resources **without service account keys** by:

1. **External Identity Provider** (Google Workspace OIDC, GitHub Actions, AWS IAM)
2. **Identity Pool** (WIF trust configuration)
3. **Service Account Impersonation** (temporary token exchange)
4. **BigQuery API Access** (using short-lived credentials)

### 1.2 Authentication Flow

```
┌────────────────────────────────────────────────────────────────────────┐
│                     Workload Identity Federation Flow                  │
└────────────────────────────────────────────────────────────────────────┘

┌──────────────────┐
│  External User   │  (Google Workspace user, GitHub Actions, etc.)
│  or Workload     │
└────────┬─────────┘
         │ 1. Authenticate with external IdP
         │
         ▼
┌────────────────────────────────────────────────────────────────────────┐
│                    External Identity Provider (IdP)                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                 │
│  │   Google     │  │   GitHub     │  │     AWS      │                 │
│  │  Workspace   │  │   Actions    │  │     IAM      │                 │
│  │    OIDC      │  │    OIDC      │  │   Provider   │                 │
│  └──────────────┘  └──────────────┘  └──────────────┘                 │
└────────┬───────────────────────────────────────────────────────────────┘
         │ 2. Issue OIDC/SAML token
         │
         ▼
┌────────────────────────────────────────────────────────────────────────┐
│                  GCP Workload Identity Pool                            │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  Identity Pool: bigquery-mcp-pool                                │  │
│  │  Location: global                                                 │  │
│  │                                                                   │  │
│  │  Providers:                                                       │  │
│  │    - google-workspace-oidc  (Google Workspace users)             │  │
│  │    - github-actions-oidc    (CI/CD pipelines)                    │  │
│  │    - aws-iam-provider       (AWS workloads)                      │  │
│  │                                                                   │  │
│  │  Attribute Mapping:                                               │  │
│  │    google.subject = assertion.sub                                │  │
│  │    google.groups = assertion.groups                              │  │
│  │    attribute.environment = assertion.aud                          │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────┬───────────────────────────────────────────────────────────────┘
         │ 3. Validate external token
         │ 4. Map to GCP principal
         │
         ▼
┌────────────────────────────────────────────────────────────────────────┐
│              Service Account Impersonation Chain                       │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  Level 1: Environment-Specific Service Accounts                  │  │
│  │                                                                   │  │
│  │  mcp-server-dev@PROJECT.iam.gserviceaccount.com                  │  │
│  │  mcp-server-staging@PROJECT.iam.gserviceaccount.com              │  │
│  │  mcp-server-prod@PROJECT.iam.gserviceaccount.com                 │  │
│  │                                                                   │  │
│  │  Permissions: Scoped to environment datasets                     │  │
│  │  Token Lifetime: 1 hour                                           │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────┬───────────────────────────────────────────────────────────────┘
         │ 5. Generate short-lived access token
         │
         ▼
┌────────────────────────────────────────────────────────────────────────┐
│                    BigQuery API Access                                 │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  Authorization: Bearer <short-lived-token>                       │  │
│  │  Token Expiry: 3600 seconds (1 hour)                             │  │
│  │  Automatic Refresh: Yes (via WIF token exchange)                 │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                 │
│  │   Datasets   │  │    Tables    │  │   Queries    │                 │
│  │   (dev)      │  │  (staging)   │  │    (prod)    │                 │
│  └──────────────┘  └──────────────┘  └──────────────┘                 │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Identity Pool Design

### 2.1 Identity Pool Structure

```yaml
# Identity Pool Configuration
name: bigquery-mcp-pool
location: global
description: Workload Identity Federation for BigQuery MCP Server

# Multi-environment support
environments:
  - development
  - staging
  - production

# Provider configurations
providers:
  - name: google-workspace-oidc
    type: oidc
    issuer_uri: https://accounts.google.com
    allowed_audiences:
      - https://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/bigquery-mcp-pool/providers/google-workspace-oidc

    # Attribute mapping
    attribute_mapping:
      google.subject: assertion.sub
      google.groups: assertion.hd  # Google Workspace domain
      attribute.email: assertion.email
      attribute.email_verified: assertion.email_verified

    # Attribute conditions (security)
    attribute_condition: |
      assertion.email_verified == true &&
      assertion.hd == "your-company.com"

  - name: github-actions-oidc
    type: oidc
    issuer_uri: https://token.actions.githubusercontent.com
    allowed_audiences:
      - https://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/bigquery-mcp-pool/providers/github-actions-oidc

    # Attribute mapping
    attribute_mapping:
      google.subject: assertion.sub
      attribute.repository: assertion.repository
      attribute.repository_owner: assertion.repository_owner
      attribute.workflow: assertion.workflow
      attribute.ref: assertion.ref

    # Attribute conditions (only allow specific repo)
    attribute_condition: |
      assertion.repository_owner == "your-org" &&
      assertion.repository == "your-org/bigquery-mcp-server"

  - name: cloud-run-identity
    type: oidc
    issuer_uri: https://accounts.google.com
    allowed_audiences:
      - https://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/bigquery-mcp-pool/providers/cloud-run-identity

    # Attribute mapping
    attribute_mapping:
      google.subject: assertion.sub
      attribute.service_name: assertion.service_name
      attribute.region: assertion.region
```

### 2.2 Service Account Impersonation Chain

```yaml
# Service Accounts (Zero Keys - WIF Only)
service_accounts:
  development:
    email: mcp-server-dev@PROJECT.iam.gserviceaccount.com
    description: Development environment service account (WIF-based)
    roles:
      - roles/bigquery.dataViewer
      - roles/bigquery.jobUser
    dataset_access:
      - project: PROJECT_ID
        dataset: dev_analytics
        role: READER
      - project: PROJECT_ID
        dataset: dev_logs
        role: READER

    # WIF principals allowed to impersonate
    impersonation_principals:
      - principal://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/bigquery-mcp-pool/subject/user@your-company.com
      - principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/bigquery-mcp-pool/attribute.repository/your-org/bigquery-mcp-server

    # Token lifetime
    token_lifetime: 3600  # 1 hour

  staging:
    email: mcp-server-staging@PROJECT.iam.gserviceaccount.com
    description: Staging environment service account (WIF-based)
    roles:
      - roles/bigquery.dataEditor
      - roles/bigquery.jobUser
    dataset_access:
      - project: PROJECT_ID
        dataset: staging_analytics
        role: WRITER

    # More restrictive impersonation
    impersonation_principals:
      - principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/bigquery-mcp-pool/attribute.repository/your-org/bigquery-mcp-server
      - principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/bigquery-mcp-pool/attribute.email_verified/true

  production:
    email: mcp-server-prod@PROJECT.iam.gserviceaccount.com
    description: Production environment service account (WIF-based)
    roles:
      - roles/bigquery.dataViewer  # Read-only in production
      - roles/bigquery.jobUser
    dataset_access:
      - project: PROJECT_ID
        dataset: prod_analytics
        role: READER
      - project: PROJECT_ID
        dataset: prod_metrics
        role: READER

    # Strictest impersonation rules
    impersonation_principals:
      - principal://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/bigquery-mcp-pool/subject/admin@your-company.com
      - principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/bigquery-mcp-pool/attribute.groups/bigquery-admins@your-company.com

    # Require approval for production access
    require_approval: true
    approval_timeout: 300  # 5 minutes
```

---

## 3. Authentication Flows by Environment

### 3.1 Google Workspace User Authentication

```typescript
/**
 * Google Workspace User → BigQuery Access
 *
 * Flow:
 * 1. User authenticates with Google Workspace
 * 2. Receives OIDC ID token from Google
 * 3. Exchanges token with WIF pool
 * 4. Impersonates environment-specific service account
 * 5. Accesses BigQuery with short-lived credential
 */

interface GoogleWorkspaceAuthFlow {
  // Step 1: User authentication
  userEmail: string;          // user@your-company.com
  workspaceDomain: string;    // your-company.com
  oidcProvider: string;       // https://accounts.google.com

  // Step 2: OIDC token from Google
  idToken: {
    iss: "https://accounts.google.com";
    sub: "110169484474386276334";  // Google user ID
    email: "user@your-company.com";
    email_verified: true;
    hd: "your-company.com";  // Hosted domain
    aud: string;  // WIF pool audience
    exp: number;
    iat: number;
  };

  // Step 3: WIF token exchange
  wifTokenExchange: {
    endpoint: "https://sts.googleapis.com/v1/token";
    request: {
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange";
      audience: "//iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/bigquery-mcp-pool/providers/google-workspace-oidc";
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt";
      subject_token: string;  // OIDC ID token
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token";
      scope: "https://www.googleapis.com/auth/cloud-platform";
    };
    response: {
      access_token: string;  // Federated token
      issued_token_type: "urn:ietf:params:oauth:token-type:access_token";
      token_type: "Bearer";
      expires_in: 3600;
    };
  };

  // Step 4: Service account impersonation
  impersonation: {
    endpoint: "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/mcp-server-dev@PROJECT.iam.gserviceaccount.com:generateAccessToken";
    request: {
      scope: ["https://www.googleapis.com/auth/bigquery"];
      lifetime: "3600s";
    };
    response: {
      accessToken: string;  // Service account token
      expireTime: string;   // RFC3339 timestamp
    };
  };

  // Step 5: BigQuery API access
  bigQueryAccess: {
    authorization: `Bearer ${impersonation.response.accessToken}`;
    tokenExpiry: 3600;  // seconds
    autoRefresh: true;
  };
}
```

**Implementation Example**:

```typescript
import {GoogleAuth} from 'google-auth-library';
import {BigQuery} from '@google-cloud/bigquery';

class WorkspaceWIFAuth {
  private auth: GoogleAuth;

  constructor(
    private workloadPoolId: string,
    private providerId: string,
    private serviceAccountEmail: string
  ) {
    // Initialize Google Auth with WIF configuration
    this.auth = new GoogleAuth({
      // Credential configuration file (replaces service account key)
      keyFilename: '/path/to/wif-config.json',

      // Or use credential config object
      credentials: {
        type: 'external_account',
        audience: `//iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/${workloadPoolId}/providers/${providerId}`,
        subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
        token_url: 'https://sts.googleapis.com/v1/token',
        service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${serviceAccountEmail}:generateAccessToken`,
        credential_source: {
          file: '/path/to/oidc-token.txt',  // Path to OIDC token file
          format: {
            type: 'text'
          }
        }
      }
    });
  }

  async getBigQueryClient(): Promise<BigQuery> {
    // Create BigQuery client with WIF credentials
    const client = await this.auth.getClient();

    return new BigQuery({
      projectId: 'your-project',
      authClient: client
    });
  }

  async executeQuery(sql: string): Promise<any[]> {
    const bigquery = await this.getBigQueryClient();

    const [rows] = await bigquery.query({
      query: sql,
      location: 'EU'
    });

    return rows;
  }
}

// Usage
const auth = new WorkspaceWIFAuth(
  'bigquery-mcp-pool',
  'google-workspace-oidc',
  'mcp-server-dev@PROJECT.iam.gserviceaccount.com'
);

const rows = await auth.executeQuery('SELECT * FROM dataset.table LIMIT 10');
```

### 3.2 GitHub Actions CI/CD Authentication

```typescript
/**
 * GitHub Actions → BigQuery Access
 *
 * Flow:
 * 1. GitHub Actions workflow runs
 * 2. Requests OIDC token from GitHub
 * 3. Exchanges token with WIF pool
 * 4. Impersonates CI/CD service account
 * 5. Runs integration tests against BigQuery
 */

// GitHub Actions workflow configuration
const githubActionsWorkflow = `
name: BigQuery Integration Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  id-token: write  # Required for OIDC token
  contents: read

jobs:
  integration-test:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Authenticate with Google Cloud via WIF
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: 'projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/bigquery-mcp-pool/providers/github-actions-oidc'
          service_account: 'mcp-server-dev@PROJECT.iam.gserviceaccount.com'
          token_format: 'access_token'

      - name: Set up Cloud SDK
        uses: google-github-actions/setup-gcloud@v2

      - name: Run BigQuery integration tests
        run: |
          npm install
          npm run test:integration
        env:
          BQ_PROJECT_ID: your-project
          BQ_DATASET_ID: dev_analytics
`;

// TypeScript implementation
interface GitHubActionsAuthFlow {
  // Step 1: GitHub OIDC token request
  githubOidcToken: {
    endpoint: "https://token.actions.githubusercontent.com";
    headers: {
      "Authorization": "Bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN";
    };
    response: {
      value: string;  // OIDC JWT token
    };
  };

  // Token claims
  tokenClaims: {
    iss: "https://token.actions.githubusercontent.com";
    sub: "repo:your-org/bigquery-mcp-server:ref:refs/heads/main";
    aud: string;  // WIF pool audience
    repository: "your-org/bigquery-mcp-server";
    repository_owner: "your-org";
    workflow: "BigQuery Integration Tests";
    ref: "refs/heads/main";
    sha: string;
    job_workflow_ref: string;
  };

  // Step 2: WIF token exchange (same as above)
  // Step 3: Service account impersonation (same as above)
}
```

### 3.3 Cloud Run Service Authentication

```typescript
/**
 * Cloud Run → BigQuery Access
 *
 * Flow:
 * 1. Cloud Run service starts with attached service account
 * 2. Metadata server provides OIDC identity token
 * 3. Exchanges token with WIF pool (optional for Cloud Run)
 * 4. OR directly uses attached service account (preferred)
 * 5. Accesses BigQuery
 *
 * Note: Cloud Run natively supports Workload Identity,
 * so direct service account attachment is recommended.
 */

interface CloudRunAuthFlow {
  // Option 1: Direct service account attachment (RECOMMENDED)
  directAttachment: {
    serviceAccount: "mcp-server-prod@PROJECT.iam.gserviceaccount.com";
    // Cloud Run automatically provides credentials
    credentialSource: "GCE_METADATA_SERVER";
    // No WIF needed - native GCP workload
  };

  // Option 2: WIF-based (for multi-cloud scenarios)
  wifBased: {
    metadataServer: "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity";
    audience: string;  // WIF pool audience
    // Rest follows standard WIF flow
  };
}

// Cloud Run deployment configuration
const cloudRunConfig = {
  service: {
    apiVersion: "serving.knative.dev/v1",
    kind: "Service",
    metadata: {
      name: "bigquery-mcp-server",
      annotations: {
        // Workload Identity configuration
        "run.googleapis.com/launch-stage": "BETA",
        "iam.gke.io/gcp-service-account": "mcp-server-prod@PROJECT.iam.gserviceaccount.com"
      }
    },
    spec: {
      template: {
        metadata: {
          annotations: {
            // Service account attachment
            "run.googleapis.com/service-account": "mcp-server-prod@PROJECT.iam.gserviceaccount.com"
          }
        },
        spec: {
          containers: [
            {
              image: "gcr.io/PROJECT/bigquery-mcp-server:latest",
              env: [
                {
                  name: "GOOGLE_CLOUD_PROJECT",
                  value: "your-project"
                },
                // No GOOGLE_APPLICATION_CREDENTIALS needed!
                // Cloud Run provides credentials automatically
              ]
            }
          ],
          serviceAccountName: "mcp-server-prod@PROJECT.iam.gserviceaccount.com"
        }
      }
    }
  }
};

// TypeScript implementation
class CloudRunWIFAuth {
  private bigquery: BigQuery;

  constructor() {
    // Cloud Run automatically provides credentials
    // via metadata server - no configuration needed!
    this.bigquery = new BigQuery({
      projectId: process.env.GOOGLE_CLOUD_PROJECT
      // No credentials parameter needed!
    });
  }

  async executeQuery(sql: string): Promise<any[]> {
    const [rows] = await this.bigquery.query({
      query: sql,
      location: 'EU'
    });

    return rows;
  }
}
```

---

## 4. Updated Component Architecture

### 4.1 Authentication Module (WIF-Based)

```typescript
/**
 * WIF Authentication Manager
 *
 * Responsibilities:
 * - Detect authentication environment (Workspace, GitHub, Cloud Run)
 * - Exchange external tokens with WIF pool
 * - Impersonate environment-specific service accounts
 * - Manage token refresh (automatic before expiry)
 * - Provide BigQuery clients with fresh credentials
 */

interface WIFAuthConfig {
  // Identity pool configuration
  identityPool: {
    projectNumber: string;
    poolId: string;
    providerId: string;
  };

  // Service account impersonation
  serviceAccount: {
    email: string;
    scopes: string[];
    lifetime: number;  // Token lifetime in seconds (max 3600)
  };

  // Credential source
  credentialSource: {
    type: 'file' | 'url' | 'environment' | 'metadata_server';
    // File-based
    file?: string;
    format?: {
      type: 'text' | 'json';
      subject_token_field_name?: string;
    };
    // URL-based
    url?: string;
    headers?: Record<string, string>;
    // Environment-based
    environmentId?: string;
  };

  // Token refresh configuration
  refresh: {
    bufferSeconds: number;  // Refresh before expiry (default: 300)
    maxRetries: number;
    retryDelayMs: number;
  };
}

class WIFAuthenticationManager {
  private authClient: GoogleAuth;
  private currentToken: {
    accessToken: string;
    expiry: Date;
  } | null = null;

  constructor(private config: WIFAuthConfig) {
    this.authClient = new GoogleAuth({
      credentials: this.buildExternalAccountCredentials()
    });

    // Start token refresh loop
    this.startTokenRefreshLoop();
  }

  /**
   * Build external account credentials configuration
   */
  private buildExternalAccountCredentials(): any {
    const {identityPool, serviceAccount, credentialSource} = this.config;

    return {
      type: 'external_account',

      // WIF pool audience
      audience: `//iam.googleapis.com/projects/${identityPool.projectNumber}/locations/global/workloadIdentityPools/${identityPool.poolId}/providers/${identityPool.providerId}`,

      // Subject token type (OIDC JWT)
      subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',

      // Token exchange endpoint
      token_url: 'https://sts.googleapis.com/v1/token',

      // Service account impersonation
      service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${serviceAccount.email}:generateAccessToken`,

      service_account_impersonation: {
        token_lifetime_seconds: serviceAccount.lifetime
      },

      // Credential source
      credential_source: credentialSource
    };
  }

  /**
   * Get BigQuery client with WIF credentials
   */
  async getBigQueryClient(projectId: string): Promise<BigQuery> {
    const client = await this.authClient.getClient();

    return new BigQuery({
      projectId,
      authClient: client
    });
  }

  /**
   * Get current access token (with automatic refresh)
   */
  async getAccessToken(): Promise<string> {
    // Check if token needs refresh
    if (this.shouldRefreshToken()) {
      await this.refreshToken();
    }

    return this.currentToken!.accessToken;
  }

  /**
   * Check if token should be refreshed
   */
  private shouldRefreshToken(): boolean {
    if (!this.currentToken) return true;

    const bufferMs = this.config.refresh.bufferSeconds * 1000;
    const expiryWithBuffer = new Date(this.currentToken.expiry.getTime() - bufferMs);

    return new Date() >= expiryWithBuffer;
  }

  /**
   * Refresh access token
   */
  private async refreshToken(): Promise<void> {
    let retries = 0;

    while (retries < this.config.refresh.maxRetries) {
      try {
        const client = await this.authClient.getClient();
        const {token, expiry_date} = await client.getAccessToken();

        this.currentToken = {
          accessToken: token!,
          expiry: new Date(expiry_date!)
        };

        console.log('[WIF] Token refreshed successfully', {
          expiry: this.currentToken.expiry,
          serviceAccount: this.config.serviceAccount.email
        });

        return;
      } catch (error) {
        retries++;
        console.error('[WIF] Token refresh failed', {
          attempt: retries,
          error: error.message
        });

        if (retries < this.config.refresh.maxRetries) {
          await new Promise(resolve =>
            setTimeout(resolve, this.config.refresh.retryDelayMs * retries)
          );
        }
      }
    }

    throw new Error('Failed to refresh WIF token after maximum retries');
  }

  /**
   * Start automatic token refresh loop
   */
  private startTokenRefreshLoop(): void {
    // Refresh every 30 minutes (tokens expire in 1 hour)
    const refreshIntervalMs = 30 * 60 * 1000;

    setInterval(async () => {
      if (this.shouldRefreshToken()) {
        try {
          await this.refreshToken();
        } catch (error) {
          console.error('[WIF] Automatic token refresh failed', error);
        }
      }
    }, refreshIntervalMs);
  }

  /**
   * Validate WIF configuration
   */
  async validateConfiguration(): Promise<{
    valid: boolean;
    errors: string[];
    warnings: string[];
  }> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Test token exchange
      const client = await this.authClient.getClient();
      await client.getAccessToken();

      // Test BigQuery access
      const bigquery = await this.getBigQueryClient(
        this.config.identityPool.projectNumber
      );
      await bigquery.getDatasets({maxResults: 1});

      return {valid: true, errors, warnings};
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        errors.push('Credential source file not found');
      } else if (error.message?.includes('invalid_grant')) {
        errors.push('Invalid external token or WIF pool configuration');
      } else if (error.message?.includes('Permission denied')) {
        errors.push('Service account lacks BigQuery permissions');
      } else {
        errors.push(error.message);
      }

      return {valid: false, errors, warnings};
    }
  }
}
```

### 4.2 Connection Manager (WIF Integration)

```typescript
/**
 * WIF-Aware Connection Manager
 *
 * Replaces service account key-based connections with WIF tokens
 */

class WIFConnectionManager {
  private clients = new Map<string, BigQuery>();
  private authManager: WIFAuthenticationManager;

  constructor(private wifConfig: WIFAuthConfig) {
    this.authManager = new WIFAuthenticationManager(wifConfig);
  }

  /**
   * Get BigQuery client for project (WIF-based)
   */
  async getClient(projectId: string): Promise<BigQuery> {
    // Check cache
    if (this.clients.has(projectId)) {
      // Verify token is still valid
      const client = this.clients.get(projectId)!;
      const isValid = await this.validateClient(client);

      if (isValid) {
        return client;
      }

      // Token expired, remove from cache
      this.clients.delete(projectId);
    }

    // Create new client with fresh WIF credentials
    const client = await this.authManager.getBigQueryClient(projectId);
    this.clients.set(projectId, client);

    return client;
  }

  /**
   * Validate client credentials are still valid
   */
  private async validateClient(client: BigQuery): Promise<boolean> {
    try {
      // Test query to validate credentials
      await client.getDatasets({maxResults: 1});
      return true;
    } catch (error: any) {
      if (error.code === 401 || error.code === 403) {
        return false;  // Token expired or invalid
      }
      throw error;  // Other error, re-throw
    }
  }

  /**
   * Execute query with automatic token refresh
   */
  async executeQuery(
    projectId: string,
    query: string,
    options?: QueryOptions
  ): Promise<any[]> {
    const client = await this.getClient(projectId);

    try {
      const [rows] = await client.query({
        query,
        ...options
      });

      return rows;
    } catch (error: any) {
      // If token expired mid-query, retry with fresh token
      if (error.code === 401) {
        console.log('[WIF] Token expired mid-query, retrying with fresh credentials');

        this.clients.delete(projectId);
        const freshClient = await this.getClient(projectId);

        const [rows] = await freshClient.query({
          query,
          ...options
        });

        return rows;
      }

      throw error;
    }
  }

  /**
   * Health check - verify WIF authentication
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    message: string;
    details: any;
  }> {
    try {
      const validation = await this.authManager.validateConfiguration();

      if (!validation.valid) {
        return {
          healthy: false,
          message: 'WIF authentication failed',
          details: {
            errors: validation.errors,
            warnings: validation.warnings
          }
        };
      }

      return {
        healthy: true,
        message: 'WIF authentication operational',
        details: {
          serviceAccount: this.wifConfig.serviceAccount.email,
          tokenLifetime: this.wifConfig.serviceAccount.lifetime,
          warnings: validation.warnings
        }
      };
    } catch (error: any) {
      return {
        healthy: false,
        message: 'WIF health check failed',
        details: {error: error.message}
      };
    }
  }
}
```

---

## 5. Environment-Specific Configurations

### 5.1 Development Environment

```json
{
  "wif_config": {
    "identity_pool": {
      "project_number": "123456789",
      "pool_id": "bigquery-mcp-pool",
      "provider_id": "google-workspace-oidc"
    },
    "service_account": {
      "email": "mcp-server-dev@PROJECT.iam.gserviceaccount.com",
      "scopes": [
        "https://www.googleapis.com/auth/bigquery"
      ],
      "lifetime": 3600
    },
    "credential_source": {
      "type": "file",
      "file": "/var/run/secrets/google/oidc-token.txt",
      "format": {
        "type": "text"
      }
    },
    "refresh": {
      "buffer_seconds": 300,
      "max_retries": 3,
      "retry_delay_ms": 1000
    }
  },
  "bigquery": {
    "default_project": "dev-project",
    "allowed_datasets": [
      "dev_analytics",
      "dev_logs",
      "dev_testing"
    ],
    "read_only": false
  }
}
```

### 5.2 Staging Environment

```json
{
  "wif_config": {
    "identity_pool": {
      "project_number": "123456789",
      "pool_id": "bigquery-mcp-pool",
      "provider_id": "github-actions-oidc"
    },
    "service_account": {
      "email": "mcp-server-staging@PROJECT.iam.gserviceaccount.com",
      "scopes": [
        "https://www.googleapis.com/auth/bigquery"
      ],
      "lifetime": 3600
    },
    "credential_source": {
      "type": "environment",
      "environment_id": "GITHUB_OIDC_TOKEN"
    },
    "refresh": {
      "buffer_seconds": 300,
      "max_retries": 3,
      "retry_delay_ms": 1000
    }
  },
  "bigquery": {
    "default_project": "staging-project",
    "allowed_datasets": [
      "staging_analytics",
      "staging_integration_tests"
    ],
    "read_only": false
  }
}
```

### 5.3 Production Environment

```json
{
  "wif_config": {
    "identity_pool": {
      "project_number": "123456789",
      "pool_id": "bigquery-mcp-pool",
      "provider_id": "cloud-run-identity"
    },
    "service_account": {
      "email": "mcp-server-prod@PROJECT.iam.gserviceaccount.com",
      "scopes": [
        "https://www.googleapis.com/auth/bigquery.readonly"
      ],
      "lifetime": 3600
    },
    "credential_source": {
      "type": "metadata_server",
      "url": "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=//iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/bigquery-mcp-pool/providers/cloud-run-identity",
      "headers": {
        "Metadata-Flavor": "Google"
      }
    },
    "refresh": {
      "buffer_seconds": 600,
      "max_retries": 5,
      "retry_delay_ms": 2000
    }
  },
  "bigquery": {
    "default_project": "prod-project",
    "allowed_datasets": [
      "prod_analytics",
      "prod_metrics"
    ],
    "read_only": true
  }
}
```

---

## 6. Security Architecture

### 6.1 Attribute-Based Access Control (ABAC)

```yaml
# IAM Policy Bindings with Attribute Conditions

# Development access (internal users only)
- role: roles/iam.workloadIdentityUser
  members:
    - principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/bigquery-mcp-pool/attribute.email_verified/true
  condition:
    title: "dev-access-workspace-users"
    expression: |
      assertion.email_verified == true &&
      assertion.hd == "your-company.com" &&
      attribute.environment == "development"

# Staging access (CI/CD + approved users)
- role: roles/iam.workloadIdentityUser
  members:
    - principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/bigquery-mcp-pool/attribute.repository/your-org/bigquery-mcp-server
  condition:
    title: "staging-access-cicd"
    expression: |
      assertion.repository_owner == "your-org" &&
      assertion.repository == "your-org/bigquery-mcp-server" &&
      assertion.ref == "refs/heads/main"

# Production access (admin group only)
- role: roles/iam.workloadIdentityUser
  members:
    - principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/bigquery-mcp-pool/attribute.groups/bigquery-admins@your-company.com
  condition:
    title: "prod-access-admin-group"
    expression: |
      assertion.email_verified == true &&
      assertion.hd == "your-company.com" &&
      "bigquery-admins@your-company.com" in assertion.groups
```

### 6.2 Zero-Trust Security Model

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Zero-Trust Architecture                          │
└────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│  Layer 1: Identity Verification                                       │
│  ────────────────────────────────────────────────────────────────    │
│  ✅ Email verified                                                    │
│  ✅ Domain matches (hd claim)                                         │
│  ✅ Group membership validated                                        │
│  ✅ Multi-factor authentication required                              │
└──────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Layer 2: Attribute-Based Access Control                             │
│  ────────────────────────────────────────────────────────────────    │
│  ✅ Environment attribute check (dev/staging/prod)                    │
│  ✅ Repository ownership validation (for GitHub)                      │
│  ✅ Time-based access windows                                         │
│  ✅ IP allowlist validation                                           │
└──────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Layer 3: Service Account Permissions                                │
│  ────────────────────────────────────────────────────────────────    │
│  ✅ Least-privilege IAM roles                                         │
│  ✅ Dataset-level restrictions                                        │
│  ✅ Query complexity limits                                           │
│  ✅ Cost quotas enforced                                              │
└──────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Layer 4: VPC Service Controls                                       │
│  ────────────────────────────────────────────────────────────────    │
│  ✅ Network perimeter enforcement                                     │
│  ✅ Data exfiltration prevention                                      │
│  ✅ Cross-project access controls                                     │
│  ✅ Private Google Access only                                        │
└──────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Layer 5: Audit & Monitoring                                         │
│  ────────────────────────────────────────────────────────────────    │
│  ✅ All access logged (Cloud Audit Logs)                              │
│  ✅ Anomaly detection alerts                                          │
│  ✅ Token usage tracking                                              │
│  ✅ Compliance reporting automated                                    │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 7. Migration Path from Service Account Keys

### 7.1 Phase 1: WIF Infrastructure Setup (Week 1)

```bash
#!/bin/bash
# migration-phase1.sh - Set up WIF infrastructure

set -e

PROJECT_ID="your-project"
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
POOL_ID="bigquery-mcp-pool"

echo "🔧 Phase 1: Setting up Workload Identity Federation"

# 1. Create Identity Pool
echo "Creating WIF pool: $POOL_ID"
gcloud iam workload-identity-pools create $POOL_ID \
  --location="global" \
  --display-name="BigQuery MCP Server Identity Pool" \
  --description="Workload Identity Federation for BigQuery MCP Server - replaces service account keys"

# 2. Create Google Workspace OIDC Provider
echo "Creating Google Workspace OIDC provider"
gcloud iam workload-identity-pools providers create-oidc google-workspace-oidc \
  --location="global" \
  --workload-identity-pool="$POOL_ID" \
  --issuer-uri="https://accounts.google.com" \
  --allowed-audiences="https://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL_ID/providers/google-workspace-oidc" \
  --attribute-mapping="google.subject=assertion.sub,google.groups=assertion.hd,attribute.email=assertion.email,attribute.email_verified=assertion.email_verified" \
  --attribute-condition="assertion.email_verified == true && assertion.hd == 'your-company.com'"

# 3. Create GitHub Actions OIDC Provider
echo "Creating GitHub Actions OIDC provider"
gcloud iam workload-identity-pools providers create-oidc github-actions-oidc \
  --location="global" \
  --workload-identity-pool="$POOL_ID" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --allowed-audiences="https://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL_ID/providers/github-actions-oidc" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner,attribute.workflow=assertion.workflow,attribute.ref=assertion.ref" \
  --attribute-condition="assertion.repository_owner == 'your-org' && assertion.repository == 'your-org/bigquery-mcp-server'"

# 4. Create environment-specific service accounts
for ENV in dev staging prod; do
  SA_EMAIL="mcp-server-$ENV@$PROJECT_ID.iam.gserviceaccount.com"

  echo "Creating service account: $SA_EMAIL"
  gcloud iam service-accounts create "mcp-server-$ENV" \
    --display-name="BigQuery MCP Server - $ENV (WIF-based)" \
    --description="Service account for $ENV environment - uses WIF, no keys"

  # Grant BigQuery permissions
  if [ "$ENV" = "prod" ]; then
    # Production: read-only
    gcloud projects add-iam-policy-binding $PROJECT_ID \
      --member="serviceAccount:$SA_EMAIL" \
      --role="roles/bigquery.dataViewer" \
      --condition=None
  else
    # Dev/Staging: read-write
    gcloud projects add-iam-policy-binding $PROJECT_ID \
      --member="serviceAccount:$SA_EMAIL" \
      --role="roles/bigquery.dataEditor" \
      --condition=None
  fi

  # Grant job user role
  gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$SA_EMAIL" \
    --role="roles/bigquery.jobUser" \
    --condition=None
done

# 5. Grant impersonation permissions
echo "Configuring service account impersonation"

# Dev: workspace users can impersonate
gcloud iam service-accounts add-iam-policy-binding \
  mcp-server-dev@$PROJECT_ID.iam.gserviceaccount.com \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL_ID/attribute.email_verified/true" \
  --condition='expression=assertion.hd == "your-company.com",title=workspace-users'

# Staging: GitHub Actions can impersonate
gcloud iam service-accounts add-iam-policy-binding \
  mcp-server-staging@$PROJECT_ID.iam.gserviceaccount.com \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL_ID/attribute.repository/your-org/bigquery-mcp-server" \
  --condition='expression=assertion.ref == "refs/heads/main",title=github-cicd'

# Prod: admin group only
gcloud iam service-accounts add-iam-policy-binding \
  mcp-server-prod@$PROJECT_ID.iam.gserviceaccount.com \
  --role="roles/iam.workloadIdentityUser" \
  --member="principal://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL_ID/subject/admin@your-company.com" \
  --condition=None

echo "✅ Phase 1 Complete: WIF infrastructure ready"
echo ""
echo "Next Steps:"
echo "1. Generate credential configuration files"
echo "2. Update application code to use WIF"
echo "3. Test in development environment"
```

### 7.2 Phase 2: Parallel Operation (Weeks 2-3)

```typescript
/**
 * Dual Authentication Support
 *
 * Supports both service account keys (legacy) and WIF (new)
 * during migration period
 */

class HybridAuthenticationManager {
  private wifAuth: WIFAuthenticationManager | null = null;
  private keyBasedAuth: GoogleAuth | null = null;
  private mode: 'wif' | 'key' | 'auto';

  constructor(config: {
    wifConfig?: WIFAuthConfig;
    keyFilePath?: string;
    mode?: 'wif' | 'key' | 'auto';
  }) {
    this.mode = config.mode || 'auto';

    // Initialize WIF if configured
    if (config.wifConfig) {
      this.wifAuth = new WIFAuthenticationManager(config.wifConfig);
    }

    // Initialize key-based auth if configured
    if (config.keyFilePath) {
      this.keyBasedAuth = new GoogleAuth({
        keyFilename: config.keyFilePath
      });
    }
  }

  async getBigQueryClient(projectId: string): Promise<BigQuery> {
    // Auto mode: prefer WIF, fall back to keys
    if (this.mode === 'auto') {
      if (this.wifAuth) {
        try {
          return await this.wifAuth.getBigQueryClient(projectId);
        } catch (error) {
          console.warn('[Hybrid] WIF failed, falling back to key-based auth', error);

          if (this.keyBasedAuth) {
            const client = await this.keyBasedAuth.getClient();
            return new BigQuery({projectId, authClient: client});
          }

          throw error;
        }
      }

      if (this.keyBasedAuth) {
        console.warn('[Hybrid] Using legacy key-based authentication');
        const client = await this.keyBasedAuth.getClient();
        return new BigQuery({projectId, authClient: client});
      }

      throw new Error('No authentication method configured');
    }

    // Forced WIF mode
    if (this.mode === 'wif') {
      if (!this.wifAuth) {
        throw new Error('WIF authentication not configured');
      }
      return await this.wifAuth.getBigQueryClient(projectId);
    }

    // Forced key mode
    if (this.mode === 'key') {
      if (!this.keyBasedAuth) {
        throw new Error('Key-based authentication not configured');
      }
      const client = await this.keyBasedAuth.getClient();
      return new BigQuery({projectId, authClient: client});
    }

    throw new Error(`Invalid authentication mode: ${this.mode}`);
  }
}

// Usage during migration
const auth = new HybridAuthenticationManager({
  wifConfig: {
    // New WIF configuration
    identityPool: {/*...*/},
    serviceAccount: {/*...*/},
    credentialSource: {/*...*/}
  },
  keyFilePath: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  mode: 'auto'  // Prefer WIF, fall back to keys
});
```

### 7.3 Phase 3: WIF-Only Operation (Week 4+)

```bash
#!/bin/bash
# migration-phase3.sh - Disable service account keys

set -e

PROJECT_ID="your-project"

echo "🔒 Phase 3: Disabling service account keys"

# List all service accounts with keys
for ENV in dev staging prod; do
  SA_EMAIL="mcp-server-$ENV@$PROJECT_ID.iam.gserviceaccount.com"

  echo "Checking keys for $SA_EMAIL"

  # List keys
  KEYS=$(gcloud iam service-accounts keys list \
    --iam-account="$SA_EMAIL" \
    --filter="keyType:USER_MANAGED" \
    --format="value(name)")

  if [ -n "$KEYS" ]; then
    echo "⚠️  Found user-managed keys for $SA_EMAIL:"
    echo "$KEYS"

    read -p "Delete these keys? (yes/no): " CONFIRM

    if [ "$CONFIRM" = "yes" ]; then
      echo "$KEYS" | while read KEY; do
        echo "Deleting key: $KEY"
        gcloud iam service-accounts keys delete "$KEY" \
          --iam-account="$SA_EMAIL" \
          --quiet
      done

      echo "✅ All keys deleted for $SA_EMAIL"
    fi
  else
    echo "✅ No user-managed keys found for $SA_EMAIL"
  fi
done

# Enforce organization policy: disable service account key creation
echo "Enforcing organization policy: disable key creation"
cat > /tmp/sa-key-policy.yaml <<EOF
name: projects/$PROJECT_ID/policies/iam.disableServiceAccountKeyCreation
spec:
  rules:
    - enforce: true
EOF

gcloud resource-manager org-policies set-policy /tmp/sa-key-policy.yaml

echo "✅ Phase 3 Complete: Service account keys disabled"
echo ""
echo "🎉 Migration Complete!"
echo "All authentication now uses Workload Identity Federation"
```

---

## 8. Operational Procedures

### 8.1 Monitoring WIF Authentication

```typescript
/**
 * WIF Authentication Monitoring
 */

interface WIFMetrics {
  // Token exchange metrics
  tokenExchanges: {
    total: number;
    successful: number;
    failed: number;
    avgLatencyMs: number;
  };

  // Token refresh metrics
  tokenRefreshes: {
    total: number;
    successful: number;
    failed: number;
    avgLatencyMs: number;
  };

  // Impersonation metrics
  impersonations: {
    total: number;
    successful: number;
    failed: number;
    byServiceAccount: Record<string, number>;
  };

  // Error breakdown
  errors: {
    invalidToken: number;
    permissionDenied: number;
    quotaExceeded: number;
    networkError: number;
    other: number;
  };
}

class WIFMonitoring {
  private metrics: WIFMetrics = {
    tokenExchanges: {total: 0, successful: 0, failed: 0, avgLatencyMs: 0},
    tokenRefreshes: {total: 0, successful: 0, failed: 0, avgLatencyMs: 0},
    impersonations: {total: 0, successful: 0, failed: 0, byServiceAccount: {}},
    errors: {
      invalidToken: 0,
      permissionDenied: 0,
      quotaExceeded: 0,
      networkError: 0,
      other: 0
    }
  };

  /**
   * Record token exchange attempt
   */
  recordTokenExchange(success: boolean, latencyMs: number, error?: Error): void {
    this.metrics.tokenExchanges.total++;

    if (success) {
      this.metrics.tokenExchanges.successful++;
      this.updateAvgLatency(this.metrics.tokenExchanges, latencyMs);
    } else {
      this.metrics.tokenExchanges.failed++;
      this.categorizeError(error!);
    }
  }

  /**
   * Export metrics to Cloud Monitoring
   */
  async exportToCloudMonitoring(): Promise<void> {
    const {Monitoring} = await import('@google-cloud/monitoring');
    const client = new Monitoring.MetricServiceClient();

    const projectId = process.env.GOOGLE_CLOUD_PROJECT!;
    const projectPath = client.projectPath(projectId);

    const timeSeriesData = [
      this.createTimeSeries(
        'wif.googleapis.com/token_exchange_count',
        this.metrics.tokenExchanges.successful,
        'Token exchanges succeeded'
      ),
      this.createTimeSeries(
        'wif.googleapis.com/token_exchange_errors',
        this.metrics.tokenExchanges.failed,
        'Token exchanges failed'
      ),
      this.createTimeSeries(
        'wif.googleapis.com/token_refresh_latency',
        this.metrics.tokenRefreshes.avgLatencyMs,
        'Token refresh latency (ms)'
      )
    ];

    await client.createTimeSeries({
      name: projectPath,
      timeSeries: timeSeriesData
    });
  }

  /**
   * Set up alerting policies
   */
  async setupAlerting(): Promise<void> {
    // Alert on high token exchange failure rate
    const alertPolicy = {
      displayName: 'WIF Token Exchange Failure Rate',
      conditions: [{
        displayName: 'Token exchange failures > 10%',
        conditionThreshold: {
          filter: 'metric.type="wif.googleapis.com/token_exchange_errors"',
          comparison: 'COMPARISON_GT',
          thresholdValue: 0.1,
          duration: {seconds: 300}
        }
      }],
      notificationChannels: [
        'projects/PROJECT/notificationChannels/EMAIL_CHANNEL'
      ],
      alertStrategy: {
        autoClose: {seconds: 3600}
      }
    };

    // Create alert policy via Cloud Monitoring API
    // (implementation details omitted for brevity)
  }
}
```

### 8.2 Troubleshooting Guide

```typescript
/**
 * WIF Troubleshooting Procedures
 */

interface TroubleshootingResult {
  issue: string;
  cause: string;
  resolution: string;
  severity: 'critical' | 'warning' | 'info';
}

class WIFTroubleshooter {
  async diagnose(): Promise<TroubleshootingResult[]> {
    const issues: TroubleshootingResult[] = [];

    // Check 1: Verify WIF pool exists
    try {
      await this.verifyWIFPool();
    } catch (error: any) {
      issues.push({
        issue: 'Workload Identity Pool not found',
        cause: error.message,
        resolution: 'Run migration-phase1.sh to create WIF infrastructure',
        severity: 'critical'
      });
    }

    // Check 2: Verify service account permissions
    try {
      await this.verifyServiceAccountPermissions();
    } catch (error: any) {
      issues.push({
        issue: 'Service account lacks required permissions',
        cause: error.message,
        resolution: 'Grant roles/bigquery.dataViewer and roles/bigquery.jobUser',
        severity: 'critical'
      });
    }

    // Check 3: Verify impersonation bindings
    try {
      await this.verifyImpersonationBindings();
    } catch (error: any) {
      issues.push({
        issue: 'Service account impersonation not configured',
        cause: error.message,
        resolution: 'Grant roles/iam.workloadIdentityUser to WIF principals',
        severity: 'critical'
      });
    }

    // Check 4: Test token exchange
    try {
      await this.testTokenExchange();
    } catch (error: any) {
      issues.push({
        issue: 'Token exchange failing',
        cause: error.message,
        resolution: 'Verify external token is valid and attribute conditions match',
        severity: 'critical'
      });
    }

    // Check 5: Verify credential source
    try {
      await this.verifyCredentialSource();
    } catch (error: any) {
      issues.push({
        issue: 'Credential source unavailable',
        cause: error.message,
        resolution: 'Check credential source file/URL/environment variable',
        severity: 'critical'
      });
    }

    return issues;
  }

  async verifyWIFPool(): Promise<void> {
    const {execSync} = await import('child_process');

    const result = execSync(
      `gcloud iam workload-identity-pools describe bigquery-mcp-pool --location=global --format=json`,
      {encoding: 'utf-8'}
    );

    const pool = JSON.parse(result);

    if (pool.state !== 'ACTIVE') {
      throw new Error(`WIF pool state is ${pool.state}, expected ACTIVE`);
    }
  }

  async verifyServiceAccountPermissions(): Promise<void> {
    const {BigQuery} = await import('@google-cloud/bigquery');
    const bigquery = new BigQuery();

    // Test BigQuery access
    await bigquery.getDatasets({maxResults: 1});
  }

  async verifyImpersonationBindings(): Promise<void> {
    const {execSync} = await import('child_process');

    const saEmail = 'mcp-server-dev@PROJECT.iam.gserviceaccount.com';
    const result = execSync(
      `gcloud iam service-accounts get-iam-policy ${saEmail} --format=json`,
      {encoding: 'utf-8'}
    );

    const policy = JSON.parse(result);
    const hasWIFBinding = policy.bindings?.some((b: any) =>
      b.role === 'roles/iam.workloadIdentityUser' &&
      b.members?.some((m: string) => m.includes('workloadIdentityPools'))
    );

    if (!hasWIFBinding) {
      throw new Error('No workload identity bindings found');
    }
  }

  async testTokenExchange(): Promise<void> {
    // Attempt full token exchange flow
    const auth = new WIFAuthenticationManager({
      identityPool: {
        projectNumber: 'PROJECT_NUMBER',
        poolId: 'bigquery-mcp-pool',
        providerId: 'google-workspace-oidc'
      },
      serviceAccount: {
        email: 'mcp-server-dev@PROJECT.iam.gserviceaccount.com',
        scopes: ['https://www.googleapis.com/auth/bigquery'],
        lifetime: 3600
      },
      credentialSource: {
        type: 'file',
        file: '/var/run/secrets/google/oidc-token.txt',
        format: {type: 'text'}
      },
      refresh: {
        bufferSeconds: 300,
        maxRetries: 3,
        retryDelayMs: 1000
      }
    });

    await auth.getAccessToken();
  }

  async verifyCredentialSource(): Promise<void> {
    const fs = await import('fs/promises');

    // Check if credential source file exists
    const credPath = '/var/run/secrets/google/oidc-token.txt';

    try {
      await fs.access(credPath);
    } catch {
      throw new Error(`Credential source file not found: ${credPath}`);
    }
  }
}
```

---

## 9. Architecture Decision Records (ADRs)

### ADR-006: Adopt Workload Identity Federation

**Status**: APPROVED
**Date**: 2025-10-26
**Deciders**: Security Team, Platform Team, BigQuery MCP Team

**Context**:
- Current architecture relies on service account JSON keys
- Keys have indefinite lifetime (security risk)
- Keys stored in environment variables and files (exposure risk)
- Manual key rotation required (operational burden)
- No centralized identity management

**Decision**:
Migrate to Workload Identity Federation for all authentication:
1. Replace all service account keys with WIF token exchange
2. Implement short-lived credentials (1-hour max)
3. Use attribute-based access control (ABAC)
4. Support multiple identity providers (Google Workspace, GitHub, AWS)
5. Zero-key storage (ephemeral tokens only)

**Rationale**:
- **Security**: Eliminates long-lived credential exposure
- **Automation**: Automatic credential rotation (hourly)
- **Compliance**: Meets zero-trust architecture requirements
- **Flexibility**: Unified authentication across platforms
- **Auditability**: Centralized access control and logging

**Consequences**:
- **Positive**:
  - Reduced security risk (no key exposure)
  - Automated credential management
  - Better compliance posture
  - Simplified multi-environment deployment
  - Improved audit trail

- **Negative**:
  - Initial migration effort (3-4 weeks)
  - Learning curve for WIF configuration
  - Dependency on external identity providers
  - Slightly increased authentication latency (~100ms token exchange)

- **Mitigation**:
  - Phased migration with parallel operation period
  - Comprehensive documentation and training
  - Fallback to ADC for emergency access
  - Token caching to minimize latency impact

**Implementation Plan**:
1. Week 1: WIF infrastructure setup
2. Weeks 2-3: Parallel operation (WIF + keys)
3. Week 4: WIF-only, disable all keys
4. Week 5+: Monitor and optimize

---

## 10. Summary and Next Steps

### 10.1 Architecture Summary

This Workload Identity Federation architecture provides:

✅ **Zero-Key Authentication**: No service account keys stored anywhere
✅ **Short-Lived Credentials**: 1-hour maximum token lifetime
✅ **Automatic Rotation**: Tokens refresh automatically
✅ **Multi-Environment Support**: Dev, staging, production with separate identities
✅ **Attribute-Based Access**: Fine-grained access control via ABAC
✅ **Multi-Platform Support**: Google Workspace, GitHub Actions, Cloud Run
✅ **Zero-Trust Security**: Identity verification at every layer
✅ **Comprehensive Monitoring**: Token metrics and alerting

### 10.2 Implementation Checklist

**Phase 1: Infrastructure (Week 1)**
- [ ] Create Workload Identity Pool
- [ ] Configure Google Workspace OIDC provider
- [ ] Configure GitHub Actions OIDC provider
- [ ] Create environment-specific service accounts
- [ ] Set up service account impersonation bindings
- [ ] Configure attribute conditions for ABAC

**Phase 2: Application Updates (Weeks 2-3)**
- [ ] Implement WIFAuthenticationManager class
- [ ] Update ConnectionManager for WIF support
- [ ] Add hybrid authentication support (WIF + keys)
- [ ] Create credential configuration files
- [ ] Update deployment configurations (Cloud Run, GitHub Actions)
- [ ] Implement monitoring and metrics

**Phase 3: Testing (Week 3)**
- [ ] Test Google Workspace authentication flow
- [ ] Test GitHub Actions CI/CD flow
- [ ] Test Cloud Run deployment
- [ ] Verify token refresh mechanism
- [ ] Load test with concurrent requests
- [ ] Security audit of WIF configuration

**Phase 4: Migration (Week 4)**
- [ ] Deploy WIF-enabled code to development
- [ ] Migrate staging environment to WIF
- [ ] Migrate production environment to WIF
- [ ] Disable all service account keys
- [ ] Enforce organization policy (no key creation)
- [ ] Update documentation

**Phase 5: Operations (Week 5+)**
- [ ] Monitor WIF metrics in Cloud Monitoring
- [ ] Set up alerting for token failures
- [ ] Document troubleshooting procedures
- [ ] Train team on WIF operations
- [ ] Conduct security review
- [ ] Plan for future enhancements

### 10.3 Success Metrics

**Security Metrics**:
- 0 service account keys in use
- 100% of authentication via WIF
- Token lifetime ≤ 1 hour
- 0 credential exposure incidents

**Performance Metrics**:
- Token exchange latency < 200ms (p95)
- Token refresh success rate > 99.9%
- Authentication availability > 99.95%
- Zero failed queries due to expired tokens

**Operational Metrics**:
- Migration completion time ≤ 4 weeks
- Zero downtime during migration
- Team WIF proficiency (survey) > 80%
- Documentation completeness score > 90%

---

**END OF WORKLOAD IDENTITY FEDERATION ARCHITECTURE**
