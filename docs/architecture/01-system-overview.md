# System Architecture Overview

## Executive Summary

The BigQuery MCP Server is an enterprise-grade Model Context Protocol (MCP) server that provides secure, scalable access to Google BigQuery from AI applications like Claude Desktop. It implements Workload Identity Federation for keyless authentication and follows cloud-native best practices.

## System Components

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Client Layer                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                  │
│  │ Claude       │  │ Custom AI    │  │ CLI Tools    │                  │
│  │ Desktop      │  │ Applications │  │              │                  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                  │
│         │                  │                  │                          │
│         └──────────────────┴──────────────────┘                          │
│                            │                                             │
│                            │ MCP Protocol (stdio/HTTP)                   │
└────────────────────────────┼─────────────────────────────────────────────┘
                             │
┌────────────────────────────┼─────────────────────────────────────────────┐
│                  MCP Server Layer                                        │
│                            │                                             │
│  ┌─────────────────────────▼──────────────────────────┐                 │
│  │         MCP Transport Layer                        │                 │
│  │  ┌──────────────┐    ┌──────────────┐             │                 │
│  │  │ STDIO        │    │ HTTP         │             │                 │
│  │  │ Transport    │    │ Transport    │             │                 │
│  │  └──────┬───────┘    └──────┬───────┘             │                 │
│  │         └──────────────┬─────┘                     │                 │
│  └────────────────────────┼───────────────────────────┘                 │
│                            │                                             │
│  ┌─────────────────────────▼──────────────────────────┐                 │
│  │         Tool Handler Layer                         │                 │
│  │  ┌──────────────┐  ┌──────────────┐               │                 │
│  │  │ Query Tool   │  │ Schema Tool  │               │                 │
│  │  │ - Validation │  │ - Dataset    │               │                 │
│  │  │ - Caching    │  │ - Table      │               │                 │
│  │  │ - Dry Run    │  │ - Column     │               │                 │
│  │  └──────┬───────┘  └──────┬───────┘               │                 │
│  │         └──────────────┬─────┘                     │                 │
│  └────────────────────────┼───────────────────────────┘                 │
│                            │                                             │
│  ┌─────────────────────────▼──────────────────────────┐                 │
│  │         Security & Auth Layer                      │                 │
│  │  ┌──────────────┐    ┌──────────────┐             │                 │
│  │  │ WIF Auth     │    │ IAM Policy   │             │                 │
│  │  │ - Token Gen  │    │ - Permission │             │                 │
│  │  │ - Refresh    │    │ - Validation │             │                 │
│  │  └──────┬───────┘    └──────┬───────┘             │                 │
│  │         └──────────────┬─────┘                     │                 │
│  └────────────────────────┼───────────────────────────┘                 │
│                            │                                             │
│  ┌─────────────────────────▼──────────────────────────┐                 │
│  │      BigQuery Client Layer                         │                 │
│  │  ┌──────────────┐    ┌──────────────┐             │                 │
│  │  │ Query        │    │ Schema       │             │                 │
│  │  │ Executor     │    │ Inspector    │             │                 │
│  │  └──────┬───────┘    └──────┬───────┘             │                 │
│  │         └──────────────┬─────┘                     │                 │
│  └────────────────────────┼───────────────────────────┘                 │
│                            │                                             │
│  ┌─────────────────────────▼──────────────────────────┐                 │
│  │    Cross-Cutting Concerns                          │                 │
│  │  ┌───────┐ ┌──────┐ ┌─────────┐ ┌──────────┐      │                 │
│  │  │Logging│ │Metrics│ │Tracing  │ │Error     │      │                 │
│  │  │Winston│ │OTEL   │ │OTEL     │ │Handling  │      │                 │
│  │  └───────┘ └──────┘ └─────────┘ └──────────┘      │                 │
│  └─────────────────────────────────────────────────────┘                 │
└────────────────────────────┬─────────────────────────────────────────────┘
                             │
                             │ Google Cloud APIs
┌────────────────────────────▼─────────────────────────────────────────────┐
│                    Google Cloud Platform                                 │
│                                                                           │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │
│  │ BigQuery        │  │ Workload        │  │ Cloud           │         │
│  │ - Datasets      │  │ Identity        │  │ Monitoring      │         │
│  │ - Tables        │  │ Federation      │  │ - Logs          │         │
│  │ - Jobs          │  │ - Tokens        │  │ - Metrics       │         │
│  │ - Streaming     │  │ - Service Acct  │  │ - Traces        │         │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘         │
└───────────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

### 1. MCP Transport Layer
- **Purpose**: Handle MCP protocol communication
- **Technologies**: @modelcontextprotocol/sdk
- **Responsibilities**:
  - STDIO transport for Claude Desktop integration
  - HTTP transport (Express-based Streamable HTTP) for Cloud Run deployment
  - Protocol serialization/deserialization
  - Connection lifecycle management

### 2. Tool Handler Layer
- **Purpose**: Implement MCP tool specifications
- **Technologies**: TypeScript, Zod for validation
- **Responsibilities**:
  - Query execution tool (query_bigquery, with dryRun parameter)
  - Schema discovery tools (list_datasets, list_tables, get_table_schema)
  - Input validation and sanitization
  - Response formatting

### 3. Security & Auth Layer
- **Purpose**: Secure authentication and authorization
- **Technologies**: google-auth-library, Workload Identity Federation
- **Responsibilities**:
  - WIF token acquisition and refresh
  - IAM permission validation
  - Service account impersonation
  - Credential lifecycle management

### 4. BigQuery Client Layer
- **Purpose**: Interface with BigQuery APIs
- **Technologies**: @google-cloud/bigquery
- **Responsibilities**:
  - Query job management
  - Streaming inserts
  - Schema introspection
  - Job monitoring and cancellation

### 5. Cross-Cutting Concerns
- **Purpose**: Observability and reliability
- **Technologies**: Winston, OpenTelemetry, Express
- **Responsibilities**:
  - Structured logging
  - Distributed tracing
  - Metrics collection
  - Error handling and recovery
  - Health checks

## Technology Stack

### Runtime
- **Node.js**: >= 22.0.0 (LTS)
- **TypeScript**: 6.0+ (strict mode)

### Core Dependencies
- **@modelcontextprotocol/sdk**: ^1.29.0 - MCP protocol implementation
- **@google-cloud/bigquery**: ^8.1.1 - BigQuery client
- **google-auth-library**: ^10.6.2 - Authentication
- **zod**: ^3.25.76 - Schema validation
- **winston**: ^3.19.0 - Logging

### Observability
- **@opentelemetry/sdk-trace-node**: ^2.6.1 - Distributed tracing
- **@opentelemetry/sdk-metrics**: ^2.6.1 - Metrics collection
- **@google-cloud/opentelemetry-cloud-monitoring-exporter**: ^0.18.0
- **@google-cloud/opentelemetry-cloud-trace-exporter**: ^2.3.0

### Development
- **tsx**: Development server with hot reload
- **jest**: Unit and integration testing
- **eslint**: Code linting
- **prettier**: Code formatting

## Deployment Architecture

### Container-Based Deployment
```
┌─────────────────────────────────────────────────────────┐
│                    Cloud Run / GKE                       │
│                                                          │
│  ┌────────────────────────────────────────────────┐    │
│  │         MCP Server Container                   │    │
│  │                                                 │    │
│  │  ┌──────────────────────────────────────┐     │    │
│  │  │  Node.js 22 Alpine                   │     │    │
│  │  │  - MCP Server Application            │     │    │
│  │  │  - OpenTelemetry Agent               │     │    │
│  │  └──────────────────────────────────────┘     │    │
│  │                                                 │    │
│  │  Environment Variables:                        │    │
│  │  - GCP_PROJECT_ID                              │    │
│  │  - WIF_POOL_ID                                 │    │
│  │  - WIF_PROVIDER_ID                             │    │
│  │  - SERVICE_ACCOUNT_EMAIL                       │    │
│  │                                                 │    │
│  │  Mounted Secrets:                              │    │
│  │  - /secrets/wif-config.json                    │    │
│  └────────────────────────────────────────────────┘    │
│                                                          │
│  Resources:                                             │
│  - CPU: 1-2 vCPU                                        │
│  - Memory: 512MB - 2GB                                  │
│  - Concurrency: 1000 requests                           │
│  - Auto-scaling: 1-10 instances                         │
└─────────────────────────────────────────────────────────┘
```

### Local Development
```
┌─────────────────────────────────────────────────┐
│           Developer Workstation                  │
│                                                  │
│  ┌────────────────────────────────────────┐    │
│  │  Claude Desktop                        │    │
│  │  - MCP Client                          │    │
│  └────────┬───────────────────────────────┘    │
│           │ stdio                               │
│  ┌────────▼───────────────────────────────┐    │
│  │  MCP Server (tsx watch)                │    │
│  │  - Hot reload enabled                  │    │
│  │  - Local WIF credentials               │    │
│  └────────┬───────────────────────────────┘    │
│           │                                      │
│           │ Google Cloud APIs                   │
│           ▼                                      │
│     Development Project                         │
└─────────────────────────────────────────────────┘
```

## Quality Attributes

### Performance
- **Query Latency**: < 2s for cached schemas, < 30s for complex queries
- **Throughput**: 100+ queries/second per instance
- **Resource Usage**: < 512MB memory, < 50% CPU under load

### Security
- **Authentication**: Workload Identity Federation (keyless)
- **Authorization**: IAM-based with least privilege
- **Data Protection**: TLS 1.3 for all communications
- **Audit**: Comprehensive logging of all operations

### Reliability
- **Availability**: 99.9% uptime SLA
- **Error Rate**: < 0.1% for valid requests
- **Recovery**: Automatic retry with exponential backoff
- **Monitoring**: Real-time alerts on failures

### Scalability
- **Horizontal**: Auto-scale from 1 to 100+ instances
- **Vertical**: Support for dataset sizes up to petabytes
- **Caching**: Schema caching for frequently accessed datasets
- **Rate Limiting**: Configurable per-client limits

### Maintainability
- **Code Coverage**: > 80% unit test coverage
- **Documentation**: Comprehensive API and architecture docs
- **Monitoring**: Distributed tracing and metrics
- **CI/CD**: Automated testing and deployment

## Next Steps

Refer to the following architecture documents for detailed designs:
1. [Component Architecture](./02-component-architecture.md)
2. [Data Flow Diagrams](./03-data-flow.md)
3. [Security Architecture](./04-security-architecture.md)
4. [Error Handling Strategy](./05-error-handling.md)
5. [Observability Design](./06-observability.md)
6. [Scalability Patterns](./07-scalability.md)
