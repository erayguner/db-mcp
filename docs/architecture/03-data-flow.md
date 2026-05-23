# Data Flow Diagrams

## Overview

This document describes the data flows for key operations in the BigQuery MCP Server.

## 1. Query Execution Flow

### Happy Path: Successful Query

```
┌─────────┐                                                    ┌──────────────┐
│ Claude  │                                                    │   BigQuery   │
│ Desktop │                                                    │   Service    │
└────┬────┘                                                    └──────┬───────┘
     │                                                                │
     │  1. MCP Request                                               │
     │  {                                                            │
     │    tool: "query_bigquery",                                    │
     │    arguments: {                                               │
     │      query: "SELECT * FROM dataset.table LIMIT 10"            │
     │    }                                                          │
     │  }                                                            │
     │─────────────────────────────────────────────┐                │
     │                                             │                │
     │                                             ▼                │
     │                                    ┌─────────────────┐       │
     │                                    │ STDIO Transport │       │
     │                                    │                 │       │
     │                                    │ - Parse JSON-RPC│       │
     │                                    │ - Validate      │       │
     │                                    └────────┬────────┘       │
     │                                             │                │
     │                                             ▼                │
     │                                    ┌─────────────────┐       │
     │                                    │ Message Router  │       │
     │                                    │                 │       │
     │                                    │ - Route to tool │       │
     │                                    └────────┬────────┘       │
     │                                             │                │
     │                                             ▼                │
     │                                    ┌─────────────────┐       │
     │                                    │  Middleware     │       │
     │                                    │                 │       │
     │  2. Validation                     │ - Input Schema  │       │
     │  - SQL syntax check                │ - Rate Limit    │       │
     │  - Parameter validation            │ - Tracing       │       │
     │  - Permission check                └────────┬────────┘       │
     │                                             │                │
     │                                             ▼                │
     │                                    ┌─────────────────┐       │
     │                                    │   Query Tool    │       │
     │                                    │                 │       │
     │  3. Authentication                 │ - Handler       │       │
     │  WIF token acquisition             └────────┬────────┘       │
     │                                             │                │
     │                                             ▼                │
     │                                    ┌─────────────────────┐   │
     │                                    │ Security Layer      │   │
     │                                    │                     │   │
     │                                    │ ┌─────────────────┐ │   │
     │                                    │ │ Auth Manager    │ │   │
     │                                    │ │                 │ │   │
     │  4. Token Request                  │ │ - Check cache   │ │   │
     │  ─────────────────────────────────►│ │ - Get WIF token ├─┼───┼──► GCP STS
     │                                    │ │ - Cache token   │ │   │
     │  5. Access Token                   │ └─────────────────┘ │   │
     │  ◄─────────────────────────────────│                     │   │
     │                                    │ ┌─────────────────┐ │   │
     │                                    │ │ Authz Manager   │ │   │
     │  6. Permission Check               │ │                 │ │   │
     │  - bigquery.jobs.create            │ │ - IAM policy    ├─┼───┼──► GCP IAM
     │  - bigquery.tables.getData         │ │ - Enforce       │ │   │
     │                                    │ └─────────────────┘ │   │
     │                                    └─────────┬───────────┘   │
     │                                              │               │
     │                                              ▼               │
     │                                    ┌─────────────────────┐   │
     │                                    │ Query Service       │   │
     │                                    │                     │   │
     │  7. Query Validation               │ ┌─────────────────┐ │   │
     │  - Syntax check                    │ │ Query Builder   │ │   │
     │  - Injection prevention            │ │                 │ │   │
     │  - Optimization                    │ │ - Validate      │ │   │
     │                                    │ │ - Sanitize      │ │   │
     │                                    │ │ - Optimize      │ │   │
     │                                    │ └────────┬────────┘ │   │
     │                                    │          │          │   │
     │  8. Submit Query Job               │ ┌────────▼────────┐ │   │
     │  ─────────────────────────────────►│ │ Job Manager     │ │   │
     │                                    │ │                 │ ├───┼──► BigQuery API
     │                                    │ │ - Submit job    │ │   │     jobs.insert()
     │  9. Job ID                         │ │ - Poll status   │ │   │
     │  ◄─────────────────────────────────│ │ - Get results   │ │   │
     │                                    │ └────────┬────────┘ │   │
     │                                    │          │          │   │
     │ 10. Poll Job Status                │          │          │   │
     │  (every 500ms)                     │          │          │   │
     │  ─────────────────────────────────►├──────────┘          │   │
     │                                    │                     ├───┼──► BigQuery API
     │ 11. Job Status: RUNNING            │                     │   │     jobs.get()
     │  ◄─────────────────────────────────┤                     │   │
     │                                    │                     │   │
     │ 12. Poll Job Status                │                     │   │
     │  ─────────────────────────────────►│                     │   │
     │                                    │                     ├───┼──► BigQuery API
     │ 13. Job Status: DONE               │                     │   │     jobs.get()
     │  ◄─────────────────────────────────┤                     │   │
     │                                    │                     │   │
     │ 14. Fetch Results                  │                     │   │
     │  ─────────────────────────────────►│                     │   │
     │                                    │ ┌─────────────────┐ │   │
     │                                    │ │ Result Parser   │ │   │
     │ 15. Formatted Results              │ │                 │ │   │
     │  ◄─────────────────────────────────│ │ - Format        ├─┼───┼──► BigQuery API
     │  {                                 │ │ - Paginate      │ │   │     jobs.getQueryResults()
     │    rows: [...],                    │ │ - Type convert  │ │   │
     │    schema: [...],                  │ └─────────────────┘ │   │
     │    totalRows: 10,                  └─────────────────────┘   │
     │    bytesScanned: 1024                                        │
     │  }                                                            │
     │                                                               │
     │ 16. Observability                                            │
     │  - Log query execution                                       │
     │  - Record metrics (duration, bytes)                          │
     │  - End trace span                                            │
     │                                                               │
     │ 17. MCP Response                                             │
     │  {                                                            │
     │    result: {                                                 │
     │      rows: [...],                                            │
     │      schema: [...]                                           │
     │    }                                                          │
     │  }                                                            │
     │◄──────────────────────────────────                           │
     │                                                               │
```

### Error Path: Query Timeout

```
┌─────────┐                                           ┌──────────────┐
│ Claude  │                                           │   BigQuery   │
│ Desktop │                                           │   Service    │
└────┬────┘                                           └──────┬───────┘
     │                                                       │
     │  1-9. Same as happy path                            │
     │                                                       │
     │ 10. Poll Job Status (attempt 1)                     │
     │  ─────────────────────────────────────────────►     │
     │ 11. Job Status: RUNNING                             │
     │  ◄─────────────────────────────────────────────     │
     │                                                       │
     │  ... (polling continues every 500ms)                │
     │                                                       │
     │ 12. Poll Job Status (attempt 60)                    │
     │  ─────────────────────────────────────────────►     │
     │ 13. Timeout Exceeded (30s)                          │
     │                                                       │
     │  ┌───────────────────────────┐                      │
     │  │  Error Handler            │                      │
     │  │                           │                      │
     │  │  - Cancel running job ────┼──────────────────────┼──► BigQuery API
     │  │  - Log error              │                      │     jobs.cancel()
     │  │  - Record metric          │                      │
     │  │  - Create error response  │                      │
     │  └───────────────────────────┘                      │
     │                                                       │
     │ 14. MCP Error Response                               │
     │  {                                                    │
     │    error: {                                          │
     │      code: "TIMEOUT",                                │
     │      message: "Query exceeded 30s timeout",          │
     │      details: {                                      │
     │        jobId: "...",                                 │
     │        elapsed: 30000                                │
     │      }                                               │
     │    }                                                 │
     │  }                                                    │
     │◄──────────────────────────────────────────────       │
     │                                                       │
```

## 2. Schema Discovery Flow

### List Datasets

```
┌─────────┐                                           ┌──────────────┐
│ Claude  │                                           │   BigQuery   │
│ Desktop │                                           │   Service    │
└────┬────┘                                           └──────┬───────┘
     │                                                       │
     │  1. MCP Request: list_datasets                       │
     │  {                                                    │
     │    tool: "list_datasets",                            │
     │    arguments: { projectId: "my-project" }            │
     │  }                                                    │
     │──────────────────────────────────►                   │
     │                                                       │
     │  2-6. Transport, Auth, Authz                         │
     │  (Same as query flow)                                │
     │                                                       │
     │  7. Check Schema Cache                               │
     │  ┌────────────────────────┐                          │
     │  │  Schema Service        │                          │
     │  │                        │                          │
     │  │  key: "datasets:my-project"                       │
     │  │                        │                          │
     │  │  ┌──────────────────┐  │                          │
     │  │  │  Cache: MISS     │  │                          │
     │  │  └──────────────────┘  │                          │
     │  └────────────────────────┘                          │
     │                                                       │
     │  8. List Datasets API Call                           │
     │  ───────────────────────────────────────────────────►│
     │                                     datasets.list()   │
     │  9. Datasets Response                                │
     │  ◄───────────────────────────────────────────────────│
     │  [                                                    │
     │    { id: "dataset1", location: "EU" },               │
     │    { id: "dataset2", location: "EU" }                │
     │  ]                                                    │
     │                                                       │
     │  10. Cache Results (TTL: 15min)                      │
     │  ┌────────────────────────┐                          │
     │  │  Schema Service        │                          │
     │  │                        │                          │
     │  │  ┌──────────────────┐  │                          │
     │  │  │  Cache: SET      │  │                          │
     │  │  │  TTL: 900s       │  │                          │
     │  │  └──────────────────┘  │                          │
     │  └────────────────────────┘                          │
     │                                                       │
     │  11. Format Response                                 │
     │  {                                                    │
     │    datasets: [                                       │
     │      {                                               │
     │        id: "dataset1",                               │
     │        location: "EU",                               │
     │        creationTime: "..."                           │
     │      },                                              │
     │      ...                                             │
     │    ]                                                 │
     │  }                                                    │
     │◄──────────────────────────────────                   │
     │                                                       │
```

### Get Table Schema (Cached)

```
┌─────────┐                                           ┌──────────────┐
│ Claude  │                                           │   BigQuery   │
│ Desktop │                                           │   Service    │
└────┬────┘                                           └──────┬───────┘
     │                                                       │
     │  1. MCP Request: get_table_schema                    │
     │  {                                                    │
     │    tool: "get_table_schema",                         │
     │    arguments: {                                      │
     │      datasetId: "dataset1",                          │
     │      tableId: "users"                                │
     │    }                                                  │
     │  }                                                    │
     │──────────────────────────────────►                   │
     │                                                       │
     │  2. Check Schema Cache                               │
     │  ┌────────────────────────┐                          │
     │  │  Schema Service        │                          │
     │  │                        │                          │
     │  │  key: "schema:dataset1.users"                     │
     │  │                        │                          │
     │  │  ┌──────────────────┐  │                          │
     │  │  │  Cache: HIT ✓    │  │                          │
     │  │  │  Age: 5min       │  │                          │
     │  │  └──────────────────┘  │                          │
     │  └────────────────────────┘                          │
     │                                                       │
     │  3. Return Cached Schema                             │
     │  {                                                    │
     │    schema: {                                         │
     │      fields: [                                       │
     │        { name: "id", type: "INT64" },                │
     │        { name: "email", type: "STRING" },            │
     │        { name: "created_at", type: "TIMESTAMP" }     │
     │      ]                                               │
     │    },                                                 │
     │    cached: true,                                     │
     │    cacheAge: 300                                     │
     │  }                                                    │
     │◄──────────────────────────────────                   │
     │                                                       │
     │  Note: No BigQuery API call made                     │
     │  Cache hit saves latency and quota                   │
     │                                                       │
```

## 3. Authentication Flow (WIF)

### Token Acquisition

```
┌─────────────┐                    ┌──────────────┐                    ┌──────────────┐
│ MCP Server  │                    │  GCP STS     │                    │  GCP IAM     │
└──────┬──────┘                    └──────┬───────┘                    └──────┬───────┘
       │                                  │                                   │
       │  1. Initialize Auth Manager                                          │
       │  ┌────────────────────────┐                                          │
       │  │ Load WIF Configuration │                                          │
       │  │                        │                                          │
       │  │ - Pool ID              │                                          │
       │  │ - Provider ID          │                                          │
       │  │ - Service Account      │                                          │
       │  └────────────────────────┘                                          │
       │                                                                       │
       │  2. Generate OIDC Token                                              │
       │  (GitHub Actions, Cloud Run, etc.)                                   │
       │  ┌────────────────────────┐                                          │
       │  │ Identity Token         │                                          │
       │  │                        │                                          │
       │  │ - Issuer: github.com   │                                          │
       │  │ - Sub: repo:org/name   │                                          │
       │  │ - Aud: //iam.goog...   │                                          │
       │  └────────────────────────┘                                          │
       │                                                                       │
       │  3. Exchange OIDC for STS Token                                      │
       │  POST /v1/token                                                      │
       │  {                                                                   │
       │    grantType: "urn:ietf:params:oauth:grant-type:token-exchange",    │
       │    audience: "//iam.googleapis.com/projects/...",                    │
       │    scope: "https://www.googleapis.com/auth/cloud-platform",          │
       │    subjectToken: "<OIDC_TOKEN>",                                    │
       │    subjectTokenType: "urn:ietf:params:oauth:token-type:jwt"         │
       │  }                                                                   │
       │──────────────────────────────────────────────────────►              │
       │                                                                       │
       │  4. STS Token Response                                               │
       │  {                                                                   │
       │    access_token: "ya29.c.b0Aa...",                                  │
       │    issued_token_type: "urn:ietf:params:oauth:token-type:access_token",│
       │    token_type: "Bearer",                                             │
       │    expires_in: 3600                                                  │
       │  }                                                                   │
       │◄──────────────────────────────────────────────────────              │
       │                                                                       │
       │  5. Impersonate Service Account                                      │
       │  POST /v1/projects/-/serviceAccounts/{email}:generateAccessToken     │
       │  {                                                                   │
       │    scope: ["https://www.googleapis.com/auth/bigquery"],             │
       │    lifetime: "3600s"                                                 │
       │  }                                                                   │
       │  Authorization: Bearer <STS_TOKEN>                                   │
       │──────────────────────────────────────────────────────────────────────►
       │                                                                       │
       │  6. Service Account Token                                            │
       │  {                                                                   │
       │    accessToken: "ya29.a0Ae...",                                     │
       │    expireTime: "2024-01-02T15:00:00Z"                               │
       │  }                                                                   │
       │◄──────────────────────────────────────────────────────────────────────
       │                                                                       │
       │  7. Cache Token                                                      │
       │  ┌────────────────────────┐                                          │
       │  │  Token Cache           │                                          │
       │  │                        │                                          │
       │  │  - Token: ya29.a0Ae... │                                          │
       │  │  - Expiry: 2024-01-02  │                                          │
       │  │  - Refresh: 55min      │                                          │
       │  └────────────────────────┘                                          │
       │                                                                       │
```

### Token Refresh

```
┌─────────────┐                    ┌──────────────┐
│ MCP Server  │                    │  GCP IAM     │
└──────┬──────┘                    └──────┬───────┘
       │                                  │
       │  1. Background Task (every 5min) │
       │  ┌────────────────────────┐      │
       │  │  Token Refresh Checker │      │
       │  │                        │      │
       │  │  Current Time: 14:55   │      │
       │  │  Expiry Time:  15:00   │      │
       │  │  Margin: 5min          │      │
       │  │  → REFRESH NEEDED      │      │
       │  └────────────────────────┘      │
       │                                  │
       │  2. Refresh Token                │
       │  (Repeat steps 3-7 from above)   │
       │──────────────────────────────────►
       │                                  │
       │  3. New Token                    │
       │  {                               │
       │    accessToken: "ya29.NEW...",   │
       │    expireTime: "2024-01-02T16:00"│
       │  }                               │
       │◄──────────────────────────────────
       │                                  │
       │  4. Update Cache                 │
       │  ┌────────────────────────┐      │
       │  │  Token Cache           │      │
       │  │                        │      │
       │  │  - OLD token invalidated│     │
       │  │  - NEW token stored     │     │
       │  └────────────────────────┘      │
       │                                  │
```

## 4. Error Handling Flow

### Retry with Exponential Backoff

```
┌─────────────┐                              ┌──────────────┐
│ MCP Server  │                              │   BigQuery   │
└──────┬──────┘                              └──────┬───────┘
       │                                            │
       │  1. Query Request                         │
       │───────────────────────────────────────────►│
       │                                            │
       │  2. Error: 503 Service Unavailable        │
       │◄───────────────────────────────────────────│
       │                                            │
       │  3. Retry Strategy                         │
       │  ┌─────────────────────────────┐           │
       │  │  Exponential Backoff        │           │
       │  │                             │           │
       │  │  Attempt 1: Wait 1s         │           │
       │  │  Attempt 2: Wait 2s         │           │
       │  │  Attempt 3: Wait 4s         │           │
       │  │  Attempt 4: Wait 8s         │           │
       │  │  Max attempts: 5            │           │
       │  └─────────────────────────────┘           │
       │                                            │
       │  4. Wait 1s                                │
       │  ⏰                                         │
       │                                            │
       │  5. Retry Attempt 1                        │
       │───────────────────────────────────────────►│
       │                                            │
       │  6. Error: 503 Service Unavailable        │
       │◄───────────────────────────────────────────│
       │                                            │
       │  7. Wait 2s                                │
       │  ⏰⏰                                        │
       │                                            │
       │  8. Retry Attempt 2                        │
       │───────────────────────────────────────────►│
       │                                            │
       │  9. Success: 200 OK                        │
       │◄───────────────────────────────────────────│
       │                                            │
       │  10. Log Retry Metrics                     │
       │  ┌─────────────────────────────┐           │
       │  │  - Total attempts: 3        │           │
       │  │  - Total delay: 3s          │           │
       │  │  - Error type: 503          │           │
       │  └─────────────────────────────┘           │
       │                                            │
```

## 5. Caching Strategy

### Multi-Level Cache

```
Request → Memory Cache → API Call → Cache Store
   ↓           ↓             ↓           ↓
 [HIT]       [HIT]        [MISS]      [STORE]
   ↓           ↓             ↓           ↓
Return      Return        Fetch       Return
```

### Cache Invalidation

```
DDL Operation Detected
   ↓
Invalidate Pattern
   ↓
┌────────────────────────────────┐
│ If: CREATE/DROP/ALTER DATASET │
│ Then: Invalidate datasets:*    │
│                                │
│ If: CREATE/DROP/ALTER TABLE   │
│ Then: Invalidate:              │
│   - datasets:project           │
│   - tables:dataset             │
│   - schema:dataset.table       │
└────────────────────────────────┘
```

## Performance Characteristics

### Query Execution

- **Latency**: 100-5000ms (depends on query complexity)
- **Throughput**: 100+ concurrent queries
- **Cache Hit Rate**: 60-80% for schema operations

### Authentication

- **Token Acquisition**: 500-2000ms (first time)
- **Token Refresh**: 200-500ms (from cache)
- **Cache Duration**: 55min (refreshed at 5min before expiry)

### Error Recovery

- **Transient Errors**: 3-5 retries with exponential backoff
- **Permanent Errors**: Fail immediately with detailed error
- **Circuit Breaker**: Open after 5 consecutive failures

## Next Steps

See [Security Architecture](./04-security-architecture.md) for detailed security design.
