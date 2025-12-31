# MCP BigQuery Server Documentation

## Overview

This directory contains documentation for the MCP BigQuery Server - an enterprise-grade Model Context Protocol server for Google Cloud BigQuery with Workload Identity Federation.

---

## Getting Started

### [USAGE-GUIDE.md](./USAGE-GUIDE.md)
Complete usage guide covering local development, testing, and production deployment. **Start here** if you want to use the server.

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

---

## External Resources

- [Workload Identity Federation Docs](https://cloud.google.com/iam/docs/workload-identity-federation)
- [BigQuery API Reference](https://cloud.google.com/bigquery/docs/reference)
- [MCP Protocol Specification](https://modelcontextprotocol.io)
- [Cloud Run Documentation](https://cloud.google.com/run/docs)
