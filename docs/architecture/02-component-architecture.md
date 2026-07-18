# Component Architecture

## Overview

This document provides detailed specifications for each component in the BigQuery MCP Server architecture.

## Component Diagram (C4 Level 2)

```
┌────────────────────────────────────────────────────────────────────────────┐
│                         BigQuery MCP Server                                │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │                      MCP Protocol Layer                              │ │
│  │                                                                      │ │
│  │  ┌─────────────────┐              ┌─────────────────┐              │ │
│  │  │ StdioTransport  │              │ HttpTransport   │              │ │
│  │  │                 │              │                 │              │ │
│  │  │ - stdin/stdout  │              │ - HTTP/Express  │              │ │
│  │  │ - JSON-RPC      │              │ - Streamable    │              │ │
│  │  └────────┬────────┘              └────────┬────────┘              │ │
│  │           │                                │                        │ │
│  │           └────────────┬───────────────────┘                        │ │
│  │                        │                                            │ │
│  │           ┌────────────▼────────────┐                              │ │
│  │           │  MessageRouter          │                              │ │
│  │           │  - Request dispatch     │                              │ │
│  │           │  - Response aggregation │                              │ │
│  │           └────────────┬────────────┘                              │ │
│  └────────────────────────┼─────────────────────────────────────────────┘ │
│                           │                                              │
│  ┌────────────────────────▼─────────────────────────────────────────────┐ │
│  │                      Tool Registry                                   │ │
│  │                                                                      │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                │ │
│  │  │ QueryTool   │  │ SchemaTool  │  │ AdminTool   │                │ │
│  │  │             │  │             │  │             │                │ │
│  │  │ - execute   │  │ - list_ds   │  │ - health    │                │ │
│  │  │ - dry_run   │  │ - list_tbl  │  │ - metrics   │                │ │
│  │  │ - cancel    │  │ - get_schema│  │             │                │ │
│  │  └─────┬───────┘  └─────┬───────┘  └─────┬───────┘                │ │
│  │        │                │                │                          │ │
│  └────────┼────────────────┼────────────────┼──────────────────────────┘ │
│           │                │                │                            │
│  ┌────────▼────────────────▼────────────────▼──────────────────────────┐ │
│  │                   Middleware Chain                                  │ │
│  │                                                                      │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │ │
│  │  │ Validator    │→ │ RateLimiter  │→ │ CacheManager │             │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘             │ │
│  │                                                                      │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │ │
│  │  │ Tracer       │→ │ Logger       │→ │ ErrorHandler │             │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘             │ │
│  └────────────────────────────┬─────────────────────────────────────────┘ │
│                               │                                           │
│  ┌────────────────────────────▼─────────────────────────────────────────┐ │
│  │                   Security Layer                                     │ │
│  │                                                                      │ │
│  │  ┌────────────────────────────────────────────────────────┐         │ │
│  │  │              AuthenticationManager                     │         │ │
│  │  │                                                        │         │ │
│  │  │  ┌──────────────┐         ┌──────────────┐            │         │ │
│  │  │  │ WIFProvider  │         │ TokenCache   │            │         │ │
│  │  │  │              │         │              │            │         │ │
│  │  │  │ - acquire    │◄────────┤ - get/set    │            │         │ │
│  │  │  │ - refresh    │         │ - invalidate │            │         │ │
│  │  │  └──────────────┘         └──────────────┘            │         │ │
│  │  │                                                        │         │ │
│  │  │  ┌──────────────────────────────────────┐             │         │ │
│  │  │  │  CredentialProvider                  │             │         │ │
│  │  │  │  - workloadIdentity                  │             │         │ │
│  │  │  │  - serviceAccountImpersonation       │             │         │ │
│  │  │  └──────────────────────────────────────┘             │         │ │
│  │  └────────────────────────────────────────────────────────┘         │ │
│  │                                                                      │ │
│  │  ┌────────────────────────────────────────────────────────┐         │ │
│  │  │              AuthorizationManager                      │         │ │
│  │  │                                                        │         │ │
│  │  │  ┌──────────────┐         ┌──────────────┐            │         │ │
│  │  │  │ IAMValidator │         │ PolicyCache  │            │         │ │
│  │  │  │              │         │              │            │         │ │
│  │  │  │ - check      │◄────────┤ - policies   │            │         │ │
│  │  │  │ - enforce    │         │ - refresh    │            │         │ │
│  │  │  └──────────────┘         └──────────────┘            │         │ │
│  │  └────────────────────────────────────────────────────────┘         │ │
│  └────────────────────────────┬─────────────────────────────────────────┘ │
│                               │                                           │
│  ┌────────────────────────────▼─────────────────────────────────────────┐ │
│  │                   BigQuery Adapter                                   │ │
│  │                                                                      │ │
│  │  ┌─────────────────────────────────────────────────────────┐        │ │
│  │  │              QueryService                               │        │ │
│  │  │                                                         │        │ │
│  │  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │        │ │
│  │  │  │ JobManager   │  │ QueryBuilder │  │ ResultParser │  │        │ │
│  │  │  │              │  │              │  │              │  │        │ │
│  │  │  │ - submit     │  │ - validate   │  │ - format     │  │        │ │
│  │  │  │ - poll       │  │ - optimize   │  │ - paginate   │  │        │ │
│  │  │  │ - cancel     │  │ - params     │  │ - stream     │  │        │ │
│  │  │  └──────────────┘  └──────────────┘  └──────────────┘  │        │ │
│  │  └─────────────────────────────────────────────────────────┘        │ │
│  │                                                                      │ │
│  │  ┌─────────────────────────────────────────────────────────┐        │ │
│  │  │              SchemaService                              │        │ │
│  │  │                                                         │        │ │
│  │  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │        │ │
│  │  │  │ MetadataAPI  │  │ SchemaCache  │  │ Introspector │  │        │ │
│  │  │  │              │  │              │  │              │  │        │ │
│  │  │  │ - datasets   │  │ - store      │  │ - analyze    │  │        │ │
│  │  │  │ - tables     │  │ - retrieve   │  │ - infer      │  │        │ │
│  │  │  │ - columns    │  │ - invalidate │  │ - suggest    │  │        │ │
│  │  │  └──────────────┘  └──────────────┘  └──────────────┘  │        │ │
│  │  └─────────────────────────────────────────────────────────┘        │ │
│  │                                                                      │ │
│  │  ┌─────────────────────────────────────────────────────────┐        │ │
│  │  │              BigQueryClient                             │        │ │
│  │  │                                                         │        │ │
│  │  │  - @google-cloud/bigquery wrapper                      │        │ │
│  │  │  - Connection pooling                                  │        │ │
│  │  │  - Retry logic                                         │        │ │
│  │  │  - Circuit breaker                                     │        │ │
│  │  └─────────────────────────────────────────────────────────┘        │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │                   Observability Layer                                │ │
│  │                                                                      │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │ │
│  │  │ Logger       │  │ Tracer       │  │ Metrics      │              │ │
│  │  │ (Winston)    │  │ (OTEL)       │  │ (OTEL)       │              │ │
│  │  │              │  │              │  │              │              │ │
│  │  │ - structured │  │ - spans      │  │ - counters   │              │ │
│  │  │ - levels     │  │ - context    │  │ - gauges     │              │ │
│  │  │ - transports │  │ - baggage    │  │ - histograms │              │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘              │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘
```

## Component Specifications

### 1. MCP Protocol Layer

#### StdioTransport

```typescript
interface StdioTransport {
  // Reads JSON-RPC messages from stdin
  receive(): Promise<MCPMessage>;

  // Writes JSON-RPC responses to stdout
  send(message: MCPMessage): Promise<void>;

  // Handles protocol errors
  handleError(error: Error): void;
}
```

**Responsibilities**:

- Line-buffered message reading from stdin
- JSON parsing and validation
- Message framing for Claude Desktop
- Protocol-level error handling

**Dependencies**:

- Node.js readline module
- @modelcontextprotocol/sdk

#### HttpTransport

```typescript
interface HttpTransport {
  // HTTP endpoint for Streamable HTTP connections
  endpoint: string;

  // Express application
  app: Express;

  // Start listening on configured port
  start(port: number): Promise<void>;
}
```

**Responsibilities**:

- Express-based Streamable HTTP for Cloud Run deployment
- Stateless request handling (`sessionIdGenerator: undefined`) — a fresh MCP `Server` and SDK transport per request, so
  any instance can serve any request without sticky sessions
- Client authentication and tenant resolution
- Liveness, readiness, and Prometheus endpoints

**Dependencies**:

- Express.js (5.x)
- @modelcontextprotocol/sdk

### 2. Tool Registry

#### QueryTool

```typescript
interface QueryTool extends MCPTool {
  name: 'query_bigquery';
  description: 'Execute SQL queries on BigQuery';

  inputSchema: {
    query: string;
    dryRun?: boolean;
    maxResults?: number;
    timeoutMs?: number;
  };

  handler(input: QueryInput): Promise<QueryResult>;
}
```

**Features**:

- SQL syntax validation
- Parameter sanitization
- Dry run cost estimation
- Query timeout enforcement
- Streaming results for large datasets

#### SchemaTool

```typescript
interface SchemaTool extends MCPTool {
  name: 'list_datasets' | 'list_tables' | 'get_table_schema';

  handler(input: SchemaInput): Promise<SchemaResult>;
}
```

**Features**:

- Metadata caching (15min TTL)
- Hierarchical browsing
- Column type inference
- Partitioning info
- Table statistics

### 3. Security Layer

#### AuthenticationManager

```typescript
class AuthenticationManager {
  private wifProvider: WIFProvider;
  private tokenCache: TokenCache;

  async authenticate(): Promise<Credentials> {
    // 1. Check token cache
    const cached = await this.tokenCache.get();
    if (cached && !this.isExpired(cached)) {
      return cached;
    }

    // 2. Acquire new token via WIF
    const token = await this.wifProvider.acquireToken();

    // 3. Cache for reuse
    await this.tokenCache.set(token);

    return token;
  }

  async refresh(token: Credentials): Promise<Credentials> {
    // Refresh expired tokens
  }
}
```

**Security Features**:

- Automatic token refresh (5min before expiry)
- Secure token storage (memory only)
- Token revocation on errors
- Audit logging of auth events

#### AuthorizationManager

```typescript
class AuthorizationManager {
  async checkPermission(principal: string, resource: string, action: string): Promise<boolean> {
    // 1. Fetch IAM policy for resource
    const policy = await this.getPolicyWithCache(resource);

    // 2. Evaluate bindings
    for (const binding of policy.bindings) {
      if (binding.members.includes(principal) && binding.role.permissions.includes(action)) {
        return true;
      }
    }

    return false;
  }
}
```

**Features**:

- IAM policy caching (10min TTL)
- Least privilege enforcement
- Conditional bindings support
- Audit trail for denials

### 4. BigQuery Adapter

#### QueryService

```typescript
class QueryService {
  private jobManager: JobManager;
  private queryBuilder: QueryBuilder;
  private resultParser: ResultParser;

  async executeQuery(sql: string, options: QueryOptions): Promise<QueryResult> {
    // 1. Validate and optimize query
    const validated = this.queryBuilder.validate(sql);
    const optimized = this.queryBuilder.optimize(validated);

    // 2. Submit query job
    const job = await this.jobManager.submit(optimized, options);

    // 3. Poll for completion
    const result = await this.jobManager.waitForCompletion(job);

    // 4. Parse and format results
    return this.resultParser.format(result, options);
  }

  async dryRun(sql: string): Promise<DryRunResult> {
    // Estimate query cost without execution
  }
}
```

**Features**:

- Query parameterization
- Cost optimization (partition pruning, clustering)
- Result pagination
- Streaming for large results
- Query job cancellation

#### SchemaService

```typescript
class SchemaService {
  private metadataAPI: MetadataAPI;
  private schemaCache: LRUCache;

  async listDatasets(projectId: string): Promise<Dataset[]> {
    const cacheKey = `datasets:${projectId}`;

    // Check cache first
    if (this.schemaCache.has(cacheKey)) {
      return this.schemaCache.get(cacheKey);
    }

    // Fetch from BigQuery
    const datasets = await this.metadataAPI.listDatasets(projectId);

    // Cache with 15min TTL
    this.schemaCache.set(cacheKey, datasets, 900);

    return datasets;
  }

  async getTableSchema(datasetId: string, tableId: string): Promise<TableSchema> {
    // Similar caching strategy for table schemas
  }
}
```

**Caching Strategy**:

- Datasets: 15min TTL
- Tables: 15min TTL
- Schemas: 30min TTL
- Invalidation on DDL operations

### 5. Observability Layer

#### Logger (Winston)

```typescript
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
    }),
  ],
});
```

**Log Levels**:

- ERROR: System errors, auth failures
- WARN: Retries, rate limits, deprecations
- INFO: Query execution, tool invocations
- DEBUG: Request/response details
- TRACE: Internal state changes

#### Tracer (OpenTelemetry)

```typescript
const tracer = trace.getTracer('bigquery-mcp-server', '1.0.0');

function traceQuery(sql: string): Span {
  const span = tracer.startSpan('bigquery.query.execute', {
    attributes: {
      'db.system': 'bigquery',
      'db.statement': sql.substring(0, 500), // Truncate
      'db.operation': 'SELECT',
    },
  });

  return span;
}
```

**Trace Attributes**:

- Request ID
- User principal
- Query text (truncated)
- Execution time
- Bytes scanned
- Rows returned

#### Metrics (OpenTelemetry)

```typescript
const meter = metrics.getMeter('bigquery-mcp-server', '1.0.0');

// Counters
const queryCounter = meter.createCounter('bigquery.queries.total', {
  description: 'Total number of queries executed',
});

// Histograms
const queryDuration = meter.createHistogram('bigquery.query.duration', {
  description: 'Query execution duration in milliseconds',
  unit: 'ms',
});

// Gauges
const activeConnections = meter.createObservableGauge('bigquery.connections.active', {
  description: 'Number of active BigQuery connections',
});
```

**Key Metrics**:

- `bigquery.queries.total{status, tool}` - Query counter
- `bigquery.query.duration` - Execution time histogram
- `bigquery.bytes.scanned` - Data processed
- `bigquery.errors.total{type}` - Error counter
- `bigquery.cache.hits{resource}` - Cache hit rate
- `mcp.requests.total{method}` - MCP request counter
- `mcp.request.duration` - MCP latency

## Component Dependencies

```
MCP Transport Layer
  └── @modelcontextprotocol/sdk

Tool Registry
  ├── zod (validation)
  └── MCP Transport Layer

Security Layer
  ├── google-auth-library
  ├── node-cache (token storage)
  └── winston (audit logs)

BigQuery Adapter
  ├── @google-cloud/bigquery
  ├── Security Layer
  └── Observability Layer

Observability Layer
  ├── winston
  ├── @opentelemetry/sdk-trace-node
  ├── @opentelemetry/sdk-metrics
  └── @google-cloud/opentelemetry-*
```

## Build and Packaging

### TypeScript Compilation

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "lib": ["ES2022"],
    "moduleResolution": "node16",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

### Docker Image

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --production=false
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
RUN addgroup -g 1001 -S mcp && adduser -S mcp -u 1001 -G mcp
USER mcp
COPY --from=builder --chown=mcp:mcp /app/dist ./dist
CMD ["node", "dist/index.js"]
```

**Image Optimization**:

- Multi-stage builds (90MB final size)
- Alpine Linux base
- Production dependencies only
- Non-root user
- Health check endpoint

## Next Steps

See [Data Flow Diagrams](./03-data-flow.md) for request processing flows.
