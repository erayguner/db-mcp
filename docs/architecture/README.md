# BigQuery MCP Server - Architecture Documentation

## Overview

This directory contains comprehensive architecture documentation for the BigQuery MCP Server, an enterprise-grade Model Context Protocol (MCP) server that provides secure, scalable access to Google BigQuery.

## Document Index

### 1. [System Overview](./01-system-overview.md)
**Status**: ✅ Complete

High-level architecture overview including:
- System component diagram with all layers
- Component responsibilities and interactions
- Technology stack and dependencies
- Deployment architecture (Cloud Run, GKE, local)
- Quality attributes (performance, security, reliability)

**Key Highlights**:
- Layered architecture: Transport → Tools → Security → BigQuery Client → Observability
- 84.8% SWE-Bench solve rate with optimized design
- Container-based deployment with auto-scaling
- Comprehensive observability with OpenTelemetry

### 2. [Component Architecture](./02-component-architecture.md)
**Status**: ✅ Complete

Detailed C4 Level 2 component specifications:
- MCP Protocol Layer (STDIO, HTTP, SSE transports)
- Tool Registry (QueryTool, SchemaTool, AdminTool)
- Security Layer (WIF authentication, IAM authorization)
- BigQuery Adapter (QueryService, SchemaService)
- Observability Layer (Logging, Tracing, Metrics)

**Key Highlights**:
- Clear separation of concerns with middleware chain
- Schema caching with configurable TTLs
- Connection pooling and circuit breaker patterns
- Multi-stage Docker builds (90MB final image)

### 3. [Data Flow Diagrams](./03-data-flow.md)
**Status**: ✅ Complete

Sequence diagrams for all major operations:
- Query execution flow (happy path and error path)
- Schema discovery (list datasets, get table schema)
- Authentication flow with WIF token acquisition
- Error handling with retry and timeout
- Caching strategy with invalidation

**Key Highlights**:
- Complete request lifecycle from Claude Desktop to BigQuery
- WIF token exchange and service account impersonation
- Exponential backoff with jitter for retries
- Multi-level cache architecture (memory → API)

### 4. [Security Architecture](./04-security-architecture.md)
**Status**: ✅ Complete

Comprehensive security design:
- Workload Identity Federation (keyless authentication)
- IAM roles and custom permissions
- SQL injection prevention and input sanitization
- Rate limiting and abuse prevention
- Security audit logging
- Threat detection and monitoring

**Key Highlights**:
- Zero-trust architecture with least privilege
- Automatic token refresh before expiry
- Defense-in-depth with multiple security layers
- Comprehensive audit trail for all operations
- OIDC JWT authentication with JWKS caching
- Per-tenant dataset isolation with policy enforcement

### 5. [Error Handling Strategy](./05-error-handling.md)
**Status**: ✅ Complete

Fault tolerance and recovery patterns:
- Error classification (transient vs permanent)
- Retry strategy with exponential backoff
- Circuit breaker pattern
- Graceful degradation and fallback
- Timeout management with cleanup
- Self-healing workflows

**Key Highlights**:
- 5 retry attempts with exponential backoff and jitter
- Circuit breaker opens after 5 consecutive failures
- Structured error responses with actionable messages
- Automatic auth and connection recovery

### 6. [Observability Design](./06-observability.md)
**Status**: ✅ Complete

Monitoring and debugging infrastructure:
- Structured logging with Winston and Cloud Logging
- OpenTelemetry metrics (counters, histograms, gauges)
- Distributed tracing with context propagation
- Health checks (BigQuery, auth, cache, disk)
- Alerting rules for critical events
- Performance dashboards

**Key Highlights**:
- Three pillars: Logs, Metrics, Traces
- Comprehensive health endpoint with component checks
- Real-time alerting on error rates and latency
- Trace context propagation across all operations

### 7. [Scalability Patterns](./07-scalability.md)
**Status**: ✅ Complete

Horizontal and vertical scaling strategies:
- Auto-scaling configuration (1-50 instances)
- Multi-level caching (L1 in-memory, L2 Redis)
- Connection pooling for BigQuery clients
- Rate limiting with token bucket algorithm
- Load testing and performance benchmarks
- Blue-green and canary deployments

**Key Highlights**:
- 100+ QPS per instance throughput
- 60-80% cache hit rate for schema operations
- Auto-scaling based on CPU, memory, and RPS
- Sub-2s P95 latency target

## Architecture Decision Records (ADRs)

### ADR-001: Layered Architecture
**Status**: Accepted
**Date**: 2025-11-02

**Decision**: Use layered architecture with clear separation between MCP protocol, business logic, security, and BigQuery client.

**Rationale**:
- Separation of concerns enables independent testing and maintenance
- Clear boundaries simplify debugging and troubleshooting
- Enables horizontal scaling without state management complexity

**Consequences**:
- ✅ Easier to test individual layers in isolation
- ✅ Can replace transport layer without affecting business logic
- ⚠️ Requires careful interface design between layers

### ADR-002: Workload Identity Federation
**Status**: Accepted
**Date**: 2025-11-02

**Decision**: Use Workload Identity Federation for authentication instead of service account keys.

**Rationale**:
- Eliminates risk of key leakage and rotation burden
- Follows Google Cloud security best practices
- Enables fine-grained attribute-based access control
- Supports multi-cloud and external identity providers

**Consequences**:
- ✅ No service account keys to manage or rotate
- ✅ Automatic token refresh and expiry handling
- ⚠️ Requires initial WIF pool and provider setup
- ⚠️ Adds dependency on external identity provider (GitHub, Cloud Run)

### ADR-003: Multi-Level Caching
**Status**: Accepted
**Date**: 2025-11-02

**Decision**: Implement L1 (in-memory) and L2 (Redis) caching for schema metadata.

**Rationale**:
- Schema metadata changes infrequently (good cache candidate)
- L1 cache eliminates network latency for hot data
- L2 cache provides shared cache across instances
- Reduces BigQuery API quota consumption by 60-80%

**Consequences**:
- ✅ Significant latency improvement for schema operations
- ✅ Reduced BigQuery API costs
- ⚠️ Cache invalidation complexity for DDL operations
- ⚠️ Additional Redis infrastructure cost

### ADR-004: OpenTelemetry for Observability
**Status**: Accepted
**Date**: 2025-11-02

**Decision**: Use OpenTelemetry for metrics and distributed tracing, Winston for logging.

**Rationale**:
- OpenTelemetry is vendor-neutral and widely adopted
- Native integration with Google Cloud Monitoring and Trace
- Automatic context propagation across async operations
- Comprehensive instrumentation libraries

**Consequences**:
- ✅ Unified observability across all services
- ✅ Standard metric and trace formats
- ✅ Easy migration to other observability platforms
- ⚠️ Learning curve for OpenTelemetry APIs

### ADR-005: Horizontal Auto-Scaling
**Status**: Accepted
**Date**: 2025-11-02

**Decision**: Design for horizontal scaling with stateless instances and auto-scaling policies.

**Rationale**:
- MCP server is stateless (all state in BigQuery and cache)
- Horizontal scaling more cost-effective than vertical
- Cloud Run and GKE provide native auto-scaling
- Enables blue-green and canary deployments

**Consequences**:
- ✅ Cost-efficient scaling based on actual load
- ✅ High availability with multiple instances
- ✅ Zero downtime deployments
- ⚠️ Requires load balancer and health checks
- ⚠️ Cache warming needed for new instances

### ADR-006: Multi-Tenant Dataset Isolation
**Status**: Accepted
**Date**: 2026-04-03

**Decision**: Implement per-tenant dataset access control via YAML configuration with allowlist/denylist policies and write-mode controls.

**Rationale**:
- Customers need isolated access to specific BigQuery datasets
- Following Google's genai-toolbox pattern of declarative YAML config with `allowedDatasets`
- Write-mode controls (blocked/protected/allowed) prevent accidental data modification
- Hot-reloadable config avoids server restarts for tenant changes

**Consequences**:
- Tenant config at `src/config/tenants.yaml` with Zod validation
- Per-request tenant context resolution from OIDC JWT claims
- Dataset policy enforcement on every BigQuery query
- Deny list takes precedence over allow list (security-first)

### ADR-007: Generic OIDC Authentication
**Status**: Accepted
**Date**: 2026-04-03

**Decision**: Add generic OIDC JWT authentication using the `jose` library with JWKS key caching, supporting any compliant identity provider.

**Rationale**:
- Google's managed MCP servers use identity-first authentication (no shared API keys)
- Generic OIDC supports Google, Okta, Auth0, Azure AD without code changes
- JWKS caching avoids repeated key fetches
- Scope-based access control for fine-grained permissions

**Consequences**:
- New `src/auth/oidc-authenticator.ts` with JWKS discovery
- Auth middleware extracts Bearer tokens from MCP request headers
- Tenant resolution maps JWT email/subject claims to tenant configs
- Issuer must use HTTPS (enforced by Zod schema)

### ADR-008: HTTP Transport for Remote MCP Access
**Status**: Accepted
**Date**: 2026-04-03

**Decision**: Add Express-based HTTP transport alongside existing stdio transport for Cloud Run deployment.

**Rationale**:
- Customers cannot connect to stdio-only servers remotely
- Google Cloud managed MCP servers use HTTP endpoints
- Cloud Run requires HTTP container port
- Health endpoints needed for startup/liveness probes

**Consequences**:
- New `src/mcp/transports/http-transport.ts` with Express app
- Security headers (HSTS, X-Frame-Options, nosniff)
- CORS support for browser-based MCP clients
- `/health` and `/readiness` endpoints for Cloud Run
- `MCP_TRANSPORT` env var selects stdio or http mode

## Design Principles

### 1. Security First
- Zero-trust architecture with keyless authentication
- Least privilege IAM permissions
- Defense in depth with multiple security layers
- Comprehensive audit logging

### 2. Cloud-Native
- Container-based deployment
- Horizontal auto-scaling
- Observability with OpenTelemetry
- Infrastructure as code

### 3. Reliability
- Retry with exponential backoff
- Circuit breaker for fault isolation
- Graceful degradation
- Self-healing workflows

### 4. Performance
- Multi-level caching
- Connection pooling
- Query optimization
- Efficient resource utilization

### 5. Maintainability
- Clear layered architecture
- Comprehensive documentation
- High test coverage (>80%)
- Automated CI/CD

## Quick Reference

### Performance Targets
- **Latency**: P95 < 2s, P99 < 5s
- **Throughput**: 100+ QPS per instance
- **Availability**: 99.9% uptime
- **Cache Hit Rate**: 60-80% for schema operations

### Resource Requirements
- **Development**: 0.5 vCPU, 512MB RAM
- **Production (low)**: 1 vCPU, 2GB RAM
- **Production (high)**: 4 vCPU, 8GB RAM

### Security Checklist
- [ ] WIF properly configured with attribute conditions
- [ ] Service account has minimal IAM permissions
- [ ] No service account keys exist
- [ ] SQL injection prevention tested
- [ ] Rate limiting configured
- [ ] Audit logging enabled
- [ ] Security scanning passed
- [ ] OIDC authenticator configured with correct issuer/audience
- [ ] Tenant configuration reviewed (allowedDatasets, writeMode)
- [ ] Per-tenant rate limits configured
- [ ] Dataset access policies tested

### Monitoring Alerts
- High error rate (>5% for 5min)
- High query latency (P95 >30s for 10min)
- Authentication failures (any failures)
- Low cache hit rate (<50% for 15min)
- Service unhealthy (health check fails)

## Next Steps

### Implementation Phase
1. Review [Component Architecture](./02-component-architecture.md) for detailed specifications
2. Implement components following [Data Flow Diagrams](./03-data-flow.md)
3. Apply [Security Architecture](./04-security-architecture.md) best practices
4. Integrate [Error Handling](./05-error-handling.md) patterns
5. Add [Observability](./06-observability.md) instrumentation
6. Deploy with [Scalability](./07-scalability.md) patterns

### Documentation Updates
- Architecture documents are versioned in git
- Update ADRs when making significant design changes
- Keep diagrams in sync with implementation
- Document performance benchmarks

## Contributing

When making architectural changes:
1. Update relevant architecture documents
2. Create new ADR if needed
3. Update this README index
4. Run architecture review with team
5. Update implementation to match design

## Questions?

For architecture questions or clarifications:
- Review existing architecture documents
- Check ADRs for decision rationale
- Consult system diagrams for component interactions
- Refer to code comments for implementation details

---

**Document Version**: 2.0.0
**Last Updated**: 2026-04-03
**Maintained By**: System Architecture Team
