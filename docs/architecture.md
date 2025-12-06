# Architecture Documentation

This document redirects to the modular architecture documentation.

## Full Documentation

For comprehensive architecture documentation, see the [architecture/](./architecture/) subdirectory:

| Document | Description |
|----------|-------------|
| [System Overview](./architecture/01-system-overview.md) | High-level system design and context |
| [Component Architecture](./architecture/02-component-architecture.md) | Component structure and interactions |
| [Data Flow](./architecture/03-data-flow.md) | Request/response patterns |
| [Security Architecture](./architecture/04-security-architecture.md) | Security design |
| [Error Handling](./architecture/05-error-handling.md) | Error handling strategies |
| [Observability](./architecture/06-observability.md) | Monitoring and logging |
| [Scalability](./architecture/07-scalability.md) | Performance and scaling |

## Quick Overview

```
Client Request
  ↓
MCP Protocol Layer (JSON-RPC over stdio)
  ↓
Security Middleware (rate limiting, injection detection)
  ↓
Tool Handlers (query, list, schema operations)
  ↓
BigQuery Client (connection pooling, optimization)
  ↓
Workload Identity Federation (keyless auth)
  ↓
Google BigQuery API
```

## Related Documentation

- [WIF Architecture](./wif-architecture.md) - Workload Identity Federation details
- [Security](./SECURITY.md) - Security middleware implementation
- [Query Optimization](./QUERY_OPTIMIZATION.md) - Query performance optimization
