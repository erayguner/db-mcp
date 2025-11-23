# GitHub Copilot Usage Guide (Enhanced for GCP BigQuery MCP Server)

> Purpose: Provide precise, security-aware, architecture-aligned guidance for using GitHub Copilot (and similar AI code assistants) when contributing to this MCP BigQuery server. Follow these rules to ensure protocol compliance, maintain Workload Identity Federation (WIF) guarantees, and avoid introducing risks.

## 1. Core Principles

1. Security First – Never introduce service account keys, static credentials, or secrets. Always prefer Workload Identity Federation.
2. MCP Protocol Compliance – All new functionality exposed to clients must follow MCP SDK patterns: capability declaration, schema validation, error typing, and stderr logging.
3. Deterministic & Auditable – Changes must be traceable, test-backed, and observable (logs + metrics where relevant).
4. Minimal Surface Area – Prefer extending existing modules over creating redundant abstractions.
5. Regression Prevention – Every behavioral change requires at least one test (unit/integration/security/performance as appropriate).

## 2. Project Conventions Recap

- Language: TypeScript (ES Modules, `"type": "module"` in `package.json`).
- Entrypoint: `src/index.ts`.
- Folders:
  - `src/auth/` – WIF auth, token exchange, identity impersonation.
  - `src/bigquery/` – Query execution, schema inspection, dataset/table metadata.
  - `src/mcp/` – MCP handlers (tools/resources/prompts/capabilities).
  - `src/config/` – Configuration resolution, environment layering.
  - `src/utils/` – Logging, error helpers, shared utilities.
  - `tests/` – Organized into `unit/`, `integration/`, `security/`, `performance/`, etc.
- Logging: All structured logs must go to stderr (JSON safe; never interleave raw console noise that could corrupt JSON-RPC streams).
- Validation: Use `zod` for all tool/resource input schemas.
- Observability: OpenTelemetry instrumentation where performance or external calls matter.

## 3. Mandatory Patterns for Copilot-Suggested Code

When Copilot suggests code, verify and adapt to these patterns before accepting:

| Concern | Required Pattern | Example |
|--------|------------------|---------|
| Input Validation | Zod schema near tool/handler definition | `const InputSchema = z.object({ query: z.string(), dryRun: z.boolean().optional() })` |
| Error Handling | Centralized error -> custom error class / mapping | `throw new McpToolError('INVALID_QUERY', 'Query exceeds limit')` |
| Logging | Use Winston logger, structured JSON | `logger.info({ event: 'tool_invocation', tool: 'query_bigquery', durationMs })` |
| Auth | Use impersonated short-lived credentials only | `authClient.getAccessToken()` via WIF chain |
| Resource Exposure | Explicit capability registration | Add to `serverCapabilities.resources` |
| Sensitive Data | Avoid logging queries containing PII; redact if necessary | `redactSensitive(query)` |
| Async Control | `async/await`, no unhandled promises | `await bigqueryClient.query({...})` |
| Limits | Rate limiting & defensive query size checks | Validate `query.length` and row limits |

## 4. Prohibited Actions (Reject Copilot Suggestions If Present)

- ANY hard-coded secrets, service account JSON, API keys, or OAuth tokens.
- Long-lived credential caching beyond lifecycle design (1-hour tokens only).
- Writing logs to stdout that could corrupt MCP streams.
- Disabling validation or bypassing Zod schemas.
- Inserting network calls to unapproved external services (stick to GCP + required libraries).
- Adding dependencies without architectural justification (see Section 9 process).
- Exporting unstable internal utilities as public API without review.
- Introducing global mutable state for auth tokens (use scoped objects).

## 5. Tool & Resource Extension Workflow

1. Define Need: Justify new tool/resource (e.g., table lineage inspection).
2. Schema First: Write Zod schema for input/output.
3. Capability Update: Register in MCP capability declaration.
4. Implementation: Access BigQuery via existing client wrappers (extend only if necessary).
5. Security Hooks: Add prompt injection + SQL validation if accepting raw query-like input.
6. Logging: Add start/end log events with latency + status.
7. Tests: Minimum set:
   - Unit: schema validation + error paths.
   - Integration: BigQuery call (mock if local).
   - Security: Injection attempt blocked.
8. Documentation: Add usage snippet to README or a dedicated doc if complex.
9. Review: Run `npm test && npm run lint && npm run typecheck` before PR.

## 6. Error Handling Standards

Use structured error classes:
```ts
interface McpErrorShape {
  code: string;          // MACHINE_READABLE (e.g., BIGQUERY_RATE_LIMIT)
  message: string;       // Human friendly
  retriable: boolean;    // Safe to retry?
  context?: Record<string, unknown>;
}
```
Guidelines:
- Map provider errors (Google) to internal codes.
- Never leak internal stack traces to client responses; log internally.
- Provide actionable messages.

## 7. Logging & Telemetry Guidelines

- Always include: `event`, `component`, `correlationId` (if available), timing metrics.
- Severity mapping: `debug` (dev only), `info` (normal ops), `warn` (degraded), `error` (failed operation), `fatal` (process-ending).
- Performance instrumentation: Wrap BigQuery calls with trace spans.
- Redaction: Use `redactSensitive()` prior to logging user-provided strings.

## 8. Testing Expectations

| Test Type | Trigger | Location | Notes |
|-----------|---------|----------|-------|
| Unit | New pure function / utility | `tests/unit` | Aim for deterministic coverage |
| Integration | External API usage | `tests/integration` | Use mocks where costly |
| Security | New input surface | `tests/security` | At least one negative path |
| Performance | New high-frequency path | `tests/performance` | Compare baseline |

Coverage Minimums (guidance):
- New module: ≥ 85% lines.
- Critical path (auth, query execution): ≥ 95% lines.

## 9. Dependency Introduction Process

Before accepting Copilot's suggestion to add a dependency:
1. Check if functionality exists already (search `/src/utils`).
2. Ensure license compatibility (MIT preferred).
3. Confirm minimal footprint (avoid bloat; evaluate install size/time).
4. Justify in PR description: performance, security, or protocol compliance benefit.
5. Update `package.json` + run `npm install` + commit lockfile change.

## 10. Performance Guardrails

- Avoid unbounded result sets – enforce row limits or use dry-run cost estimates.
- Batch metadata calls where possible.
- Do not block event loop with large synchronous loops; prefer streaming or pagination.
- Reuse BigQuery client; do not recreate per request.

## 11. Security Middleware Integration

Always route new externally-invoked handlers through:
- Rate limiter check.
- Prompt / injection detectors (if accepts freeform text or SQL).
- Sensitive data scanning (if returns raw query results).

## 12. Code Style & Formatting

- Run `npm run lint:fix` before committing.
- Prefer explicit return types for exported functions.
- Avoid default exports; use named exports for clarity.
- Group imports: external libs, internal modules, types.
- No wildcard imports (`import * as ...`) unless required for SDK.

## 13. Example: Adding a New Tool (Checklist)

```
[ ] Define Zod schemas (input/output)
[ ] Implement business logic (use existing clients)
[ ] Add capability registration
[ ] Integrate security middleware
[ ] Structured logging (start/end/error)
[ ] Add traces (span name = tool:<name>)
[ ] Write tests (unit + integration + security)
[ ] Update documentation (README Tools section)
[ ] Run quality gates (lint/typecheck/tests)
```

## 14. Pull Request Template (For Copilot-Generated Changes)

```
Title: <component>: <summary>

Summary:
- Purpose / problem solved
- Architectural alignment
- Security considerations

Changes:
- List of modules updated
- New dependencies (if any) + justification

Testing:
- Unit: files + coverage summary
- Integration: scenarios exercised
- Security: attack cases blocked
- Performance: baseline vs new (if applicable)

Risks & Mitigations:
- Potential regression areas and safeguards

Checklist:
- [ ] Lint
- [ ] Typecheck
- [ ] Tests pass
- [ ] Docs updated
- [ ] No secrets / static credentials
```

## 15. Quick Reject Heuristics

Immediately reject Copilot suggestions that:
- Copy large vendor code blocks verbatim (possible license issue).
- Use deprecated Node APIs (e.g., `require()` in ES module context).
- Omit error handling for async calls.
- Introduce dynamic `eval()` or function constructors.
- Log entire query results without redaction.

## 16. Safe Refactoring Guidance

- Move logic behind stable interfaces before large changes.
- Add characterization tests around legacy behavior prior to refactor.
- Refactor incrementally (small PRs) – do not combine with new features.

## 17. Observability Hooks for New Features

Add trace spans:
```ts
const span = tracer.startSpan('tool:lineage_lookup');
try {
  // work
  span.setAttribute('row.count', rows.length);
} finally {
  span.end();
}
```
Metrics (if warranted): create counters/gauges for frequency or latency buckets.

## 18. Local Development Aids

- Use mock mode from `USAGE-GUIDE.md` for fast iteration.
- Run `npm run dev` (tsx watch) for hot reload.
- Use Jest watch for test-driven development: `npm run test:watch`.

## 19. MCP Compliance Recap (Must Preserve)

- Capabilities advertised accurately.
- All logs -> stderr.
- Graceful shutdown handlers present (do not remove).
- Structured error responses with `isError`.

## 20. Final Pre-Commit Gate

Run:
```bash
npm run lint && npm run typecheck && npm test
```
Confirm:
- No eslint errors.
- No TypeScript errors.
- Tests green.

## 21. Revision Strategy

Update this guide if:
- MCP SDK major version upgrade.
- Logging infrastructure changes.
- Security model adjustments.
- BigQuery client API changes.

Tag PR with `docs:copilot-guidelines` when modifying.

---
Maintainer Note: These instructions are living; optimize them as architecture evolves. Treat Copilot as an accelerant, not an authority.

