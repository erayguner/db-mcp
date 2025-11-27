# agent.md - Agent Operations & Coordination Guide

Purpose: Define roles, workflows, and safeguards for human + AI agents collaborating on the GCP BigQuery MCP Server while preserving security, protocol integrity, and performance.

## 1. Principles
1. Security Integrity – Maintain Workload Identity Federation; forbid static credentials.
2. Incremental Evolution – Small, reviewable changes.
3. Protocol Fidelity – MCP handlers must remain spec-compliant.
4. Observability Everywhere – Instrument external calls and critical paths.
5. Test Coverage Discipline – Prevent regressions through layered tests.

## 2. Roles
| Role | Primary Focus | Directories |
|------|---------------|------------|
| Architect | Structure & boundaries | `src/mcp`, `src/config` |
| Security | Middleware & input defense | `src/auth`, `src/utils` |
| Data | Query performance & cost | `src/bigquery` |
| Observability | Logging & tracing | instrumentation in `src/monitoring` |
| Infra | Terraform & deployment | `terraform/`, `scripts/` |
| QA/Test | Coverage & regression | `tests/` |
| Docs | Clarity & discoverability | `docs/` + root README |

## 3. Task Types & Outputs
| Task | Required Artifacts |
|------|-------------------|
| Feature | Code + schemas + tests + docs |
| Hardening | Middleware updates + negative security tests |
| Optimization | Benchmark diff + performance test |
| Refactor | Characterization tests + migration notes |
| Infra | Terraform plan + validation script output |
| Docs | Markdown diff + cross-link updates |
| Incident | Reproduction + root cause + fix plan |

## 4. Multi-Agent Workflow
1. Scan & Context: Review architecture/security docs.
2. Design Note: Brief ADR or summary for non-trivial changes.
3. Split Tasks: Parallelize (schemas, handler, tests, docs).
4. Implement & Instrument.
5. Validate: Run quality gates.
6. Review & Merge.
7. Post-Deploy: Run `validate-mcp.sh` + smoke tests.

## 5. MCP Handler Guardrails
- Capability registration preserved.
- Zod validation present for all inputs.
- Structured stderr logging only.
- Error objects standardized (`code`, `message`, `retriable`).
- No side-channel stdout noise.

## 6. Security Guardrails
- Reject raw secrets or service account key JSON.
- Enforce rate limiting unchanged unless justified.
- Validate SQL inputs; block injection patterns.
- Redact sensitive data before logging.
- Use short-lived impersonated tokens only.

## 7. Refactoring Protocol
```
[ ] Identify seams & interfaces
[ ] Add characterization tests
[ ] Incremental internal changes
[ ] Preserve external contracts
[ ] Update docs after stability achieved
```

## 8. Performance Optimization Flow
1. Baseline metrics (trace spans / integration test).
2. Hypothesis & target (e.g., -25% latency).
3. Implement batching/indexing/cache.
4. Measure & compare.
5. Document improvement.

## 9. Dependency Policy
Provide in PR:
- Justification (security/perf/compliance).
- License (MIT/Apache preferred).
- Size & install impact.
- Alternative considered.
- Removal plan if abandoned.

## 10. Observability Checklist
```
[ ] Trace span around external calls
[ ] Log start/end/error (structured)
[ ] Set key attributes (latency, rows, dataset)
[ ] Metrics (counter/histogram if high-volume)
```

## 11. Testing Matrix
| Scenario | Tests |
|----------|-------|
| New Tool | unit + integration + security |
| Auth Change | integration + security |
| Logging Change | unit (format) + integration (stderr) |
| Performance Change | performance + regression |
| Refactor | characterization + regression |

## 12. Quality Gates
```
npm run lint
npm run typecheck
npm test
```
Block on failures or unaddressed warnings.

## 13. PR Review Checklist
```
[ ] Scope clear
[ ] No secrets
[ ] Validation present
[ ] Logging structured
[ ] Tests passing
[ ] Docs updated
[ ] Observability added (if applicable)
[ ] Dependencies justified
```

## 14. Conflict Resolution
- Prioritize: Security > Stability > Performance > Style.
- Rebase rather than force merges.
- Escalate architecture decisions via ADR in `docs/architecture/`.

## 15. Rollback Procedure
1. Run `scripts/rollback-mcp.sh`.
2. Verify health & basic tool invocation.
3. Log incident (`docs/INCIDENTS/<date>-<id>.md`).
4. Post-mortem within 24h.

## 16. Security Incident Flow
1. Isolate affected tool.
2. Patch with reproducing test.
3. Audit similar patterns.
4. Document in `SECURITY.md`.

## 17. Documentation Sync
- Update root README for user-facing changes.
- Add specialized doc or section as needed.
- Link in `docs/README.md` index.

## 18. Commit Conventions
- Conventional prefixes (feat, fix, perf, refactor, docs, test, chore, security).
- Descriptive summary line + details.
- Reference issue IDs.

## 19. Autonomous Agent Limits
Do NOT:
- Modify Terraform state manually.
- Remove security logging.
- Introduce experimental flags default-enabled.
- Reduce credential rotation security.

## 20. Architecture Consistency Checks
- No circular imports.
- Single responsibility per module.
- Shared logic moved to `src/utils/`.
- MCP registration centralized.

## 21. Example Coordinated Feature
Add lineage inspection:
```
Architect: schemas + handler skeleton
Data: lineage query logic
Security: input sanitization
Observability: spans + metrics
QA: tests (unit/integration/security)
Docs: README tool section
```

## 22. Risk Categories
| Risk | Mitigation |
|------|------------|
| Credential leak | Pre-commit scan + review |
| Cost spike | LIMIT enforcement + dry-run |
| Latency regression | Performance tests gating |
| Protocol drift | Run `validate-mcp.sh` |
| Log corruption | Enforce stderr only |

## 23. Tool Sunset Policy
1. Mark deprecated in docs.
2. Observe zero usage 14 days.
3. Remove code/tests/docs.
4. Record in refactoring log.

## 24. Continuous Improvement Loop
- Review coverage report.
- Analyze trace latency hotspots.
- Refresh security patterns quarterly.
- Update guidelines when friction observed.

## 25. Onboarding Checklist
```
[ ] Read README
[ ] Skim architecture.md (MCP + BigQuery sections)
[ ] Review SECURITY.md & wif-security-guide.md
[ ] Run local dev (mock mode) & tests
[ ] Inspect src/mcp for handler patterns
[ ] Read GitHub Copilot Instructions doc
```

## 26. Local Commands
```
npm install
npm run dev
npm test
npm run lint && npm run typecheck
```

## 27. Escalation Paths
- Architecture: ADR
- Security: security issue ticket
- Performance: perf regression ticket

## 28. Roadmap Seeds (Add to docs/ROADMAP.md when created)
- Lineage graph tool
- Query cost estimator
- Adaptive rate limiting

## 29. Update Policy
Revise this doc on major protocol/security/architecture shifts. Tag PR: `docs:agent`.

## 30. Closing
Agents extend capability; maintainers ensure governance. Prioritize safety, clarity, and incremental value.

---
End of agent.md.
