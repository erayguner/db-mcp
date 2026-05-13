# MCP BigQuery Server Documentation

## Overview

This directory contains documentation for the MCP BigQuery Server - an enterprise-grade Model Context Protocol server for Google Cloud BigQuery with Workload Identity Federation.

---

## Getting Started

### [USAGE-GUIDE.md](./USAGE-GUIDE.md)
Complete usage guide covering local development, testing, and production deployment. **Start here** if you want to use the server.

### [GEMINI-ENTERPRISE-DEPLOYMENT.md](./GEMINI-ENTERPRISE-DEPLOYMENT.md)
Runbook for registering this server as a custom MCP connector in Gemini Enterprise. Covers OAuth 2.0 discovery, strict Streamable HTTP, the Vertex AI Search redirect URI, and the cost-elicitation gate.

### [MCP-COMPLIANCE.md](./MCP-COMPLIANCE.md)
MCP 2025-06-18 spec compliance matrix, gap implementations, and the native feature catalogue (tools, resources, resource templates, prompts, elicitation).

---

## Architecture

### [architecture/](./architecture/)
Modular architecture documentation:
- [System Overview](./architecture/01-system-overview.md)
- [Component Architecture](./architecture/02-component-architecture.md)
- [Data Flow](./architecture/03-data-flow.md)
- [Security Architecture](./architecture/04-security-architecture.md)
- [Error Handling](./architecture/05-error-handling.md)
- [Observability](./architecture/06-observability.md)
- [Scalability](./architecture/07-scalability.md)

### [connection-pooling-design.md](./connection-pooling-design.md)
BigQuery connection pool design and implementation.

---

## Security

### [SECURITY.md](./SECURITY.md)
Security middleware implementation including rate limiting, injection detection, and data redaction.

### [wif-architecture.md](./wif-architecture.md)
Workload Identity Federation architecture and keyless authentication.

### [wif-security-guide.md](./wif-security-guide.md)
WIF security best practices and token lifecycle management.

### [security-architecture.md](./security-architecture.md)
Security design patterns and implementation details.

### [authentication-guide.md](./authentication-guide.md)
Authentication methods and configuration.

---

## Multi-Tenancy

### Tenant Configuration
Per-tenant dataset access policies with YAML-based configuration. See `src/config/tenants.yaml` for the default config format.

**Key features:**
- Dataset allowlist/denylist per tenant
- Write-mode controls (blocked/protected/allowed)
- Per-tenant rate limiting
- OIDC subject pattern matching for automatic tenant resolution
- Hot-reloadable configuration via file watching

### Implementation Plan
See [Enterprise Database MCP Server Plan](./superpowers/plans/2026-04-03-enterprise-database-mcp-server.md) for the full architecture and implementation details.

---

## Deployment

### [wif-deployment-guide.md](./wif-deployment-guide.md)
Step-by-step deployment guide for Workload Identity Federation.

### [DOCKER-DEPLOYMENT.md](./DOCKER-DEPLOYMENT.md)
Docker containerization and Cloud Run deployment.

### [LOCAL-TESTING.md](./LOCAL-TESTING.md)
Local development and testing setup.

---

## Monitoring

### [MONITORING-GUIDE.md](./MONITORING-GUIDE.md)
OpenTelemetry instrumentation, alerts, and dashboards.

### [health-monitoring.md](./health-monitoring.md)
Health check implementation and endpoints.

---

## Features

### [QUERY_OPTIMIZATION.md](./QUERY_OPTIMIZATION.md)
Query caching, optimization, and cost control.

### [dataset-discovery-guide.md](./dataset-discovery-guide.md)
Cross-project dataset discovery and search.

### [multi-project-manager.md](./multi-project-manager.md)
Multi-project BigQuery management.

### MCP Server Features (New)
- **Prompt Providers** — 5 BigQuery-specific prompt templates for AI clients
- **Streamable HTTP Transport** — Production transport for Cloud Run (POST/GET + SSE)
- **Progress Notifications** — Real-time status for long-running queries
- **Session Management** — Multi-turn query session tracking
- **Request Batching** — JSON-RPC batch processing
- **Column Masking** — Per-tenant column-level data masking
- **Response Compression** — Gzip compression for large payloads
- **Behavioral Anomaly Detection** — Per-user query pattern baselines
- **Intelligence Effectiveness Metrics** — Tool call quality tracking
- **Graceful Degradation** — Circuit breaker with stale cache fallback

---

## Quick Reference

| Topic | Document |
|-------|----------|
| Getting started | [USAGE-GUIDE.md](./USAGE-GUIDE.md) |
| Architecture | [architecture/](./architecture/) |
| Security | [SECURITY.md](./SECURITY.md) |
| Deployment | [wif-deployment-guide.md](./wif-deployment-guide.md) |
| Docker | [DOCKER-DEPLOYMENT.md](./DOCKER-DEPLOYMENT.md) |
| Local dev | [LOCAL-TESTING.md](./LOCAL-TESTING.md) |
| Monitoring | [MONITORING-GUIDE.md](./MONITORING-GUIDE.md) |
| Query optimization | [QUERY_OPTIMIZATION.md](./QUERY_OPTIMIZATION.md) |
| Multi-tenancy | `src/config/tenants.yaml` |
| OIDC Auth | [authentication-guide.md](./authentication-guide.md) |
| Implementation Plan | [Enterprise Plan](./superpowers/plans/2026-04-03-enterprise-database-mcp-server.md) |

---

## External Resources

- [Workload Identity Federation Docs](https://cloud.google.com/iam/docs/workload-identity-federation)
- [BigQuery API Reference](https://cloud.google.com/bigquery/docs/reference)
- [MCP Protocol Specification](https://modelcontextprotocol.io)
- [Cloud Run Documentation](https://cloud.google.com/run/docs)
