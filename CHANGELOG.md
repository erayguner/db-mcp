# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Remove unused `QueryBuilder` class from BigQuery client
- Simplify `BigQueryClient` config parsing (remove redundant fallbacks after Zod defaults)
- Fix lint warnings (unused catch bindings in credential-manager and client)
- Update documentation to match current implementation

## [1.1.0] - 2026-04-04

### Added

- Multi-tenant isolation with per-tenant dataset access policies (allowlist/denylist, write-mode controls)
- OIDC authenticator with JWKS validation and token caching
- Tenant registry with hot-reload support from YAML config
- Auth middleware for MCP request pipeline
- Per-request tenant context factory
- Per-tenant rate limit overrides in security middleware
- HTTP transport with Express for Cloud Run deployment
- MCP tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`)
- BigQuery response provenance metadata (source, freshness, console URLs)
- Schema context in tool responses for copilot consumption
- Comprehensive MCP-layer metrics (per-tool latency histograms, protocol method counters, payload sizes, security
  events, in-flight tracking, uptime gauge)
- Prometheus metrics endpoint
- Cloud Audit Log structured events
- Jest-friendly mocks for MCP SDK components
- Dependabot configuration for automated dependency updates

### Changed

- BigQuery default location changed from `US` to `EU` (`europe-west2`)
- MCP transport default changed from `stdio` to `http` in Docker/Cloud Run
- Dockerfile optimized: multi-stage build, non-root user, production-only deps
- Terraform providers upgraded to v7, minimum Terraform bumped to 1.14
- Terraform Cloud Run config updated for HTTP transport, Secret Manager tenant config, and health probes
- MegaLinter upgraded to v8
- Trivy action bumped to 0.35.0
- All npm dependencies upgraded to latest stable

### Fixed

- Sensitive data detection regex handling improved
- MegaLinter v8 crash resolved
- Trivy CVEs suppressed (CVE-2026-33750, CVE-2026-33672)
- CI deploy workflow parallelized (lint, typecheck, test run concurrently)

## [1.0.0] - 2024-10-27

### Added

- MCP server for BigQuery with Workload Identity Federation
- Tools: query_bigquery, list_datasets, list_tables, get_table_schema
- Security middleware with rate limiting and injection detection
- OpenTelemetry observability (metrics, tracing)
- Connection pooling with health checks
- Dataset metadata caching with LRU eviction
- Query optimizer with cost estimation and LIMIT injection
- Query metrics tracker with slow/expensive query detection
- Dataset discovery with cross-project search and relationship mapping
- Multi-project manager with quota tracking
- Docker multi-stage build
- CI/CD with GitHub Actions (lint, typecheck, test, deploy)
- MegaLinter and Trivy security scanning
