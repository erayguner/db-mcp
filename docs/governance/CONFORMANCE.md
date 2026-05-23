# Governance Framework Conformance — db-mcp

Maps this repository to `AGENT_GOVERNANCE_FRAMEWORK.md`. db-mcp is an MCP **tool provider** (BigQuery read surface), not
an agent host, so only the framework sections that bind a tool-side service are tracked here. Sections scoped to agent
hosts (§3.1 role promotion, §5 approval gates on destructive actions, §10 rationale synthesis, §16.6 fine-tuning) are
listed as N/A with justification.

Target maturity: **L2 — Production-ready** with partial L3 controls.

## §3 — Agent roles and boundaries

| Control                         | Status | Reference                                                                                                                                   |
| ------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| §3.2 Boundary contract per tool | ✅     | `docs/governance/boundary-contracts/*.json`, schema in `src/governance/boundary-contract.ts`, CI gate in `.github/workflows/governance.yml` |
| §3.3 Multi-agent provenance     | N/A    | db-mcp does not delegate to downstream agents.                                                                                              |

## §4 — Tool and MCP access controls

| Control                                                  | Status    | Reference                                                                                                      |
| -------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------- |
| §4.1 Structured sandboxing                               | ✅        | `src/mcp/handlers/tool-handlers.ts` routes every call through a single dispatch (`ToolHandlerFactory.execute`) |
| §4.2 Declarative policy (allow-list, budgets, arg gates) | ✅        | `config/policies/tool-governance.json` loaded by `src/governance/policy.ts`                                    |
| §4.3 Registry-led categorisation                         | ✅        | `categories` field on every tool in `config/policies/tool-governance.json`                                     |
| §4.4 Per-principal budgets                               | ⚠ partial | budget _limits_ declared; runtime enforcement still pending (tracked below)                                    |
| §4.5 MCP catalogue drift                                 | ✅        | `src/governance/catalogue-hasher.ts` + tests                                                                   |

## §7 — Least-privilege execution

| Control                                    | Status | Reference                                                                          |
| ------------------------------------------ | ------ | ---------------------------------------------------------------------------------- |
| §7.1 Per-agent identity (WIF)              | ✅     | `terraform/modules/workload-identity-federation/`, `src/auth/wif-authenticator.ts` |
| §7.2 Scoped IAM — no `*:*`                 | ✅     | IAM module limits to `bigquery.jobs.create` + dataset-level reader                 |
| §7.3 Tool scope mirrors IAM                | ✅     | Allow-list in `tool-governance.json` ⊆ granted IAM                                 |
| §7.5 Network scope (VPC-SC, egress denied) | ✅     | `terraform/modules/networking/`                                                    |
| §7.6 Managed runtime                       | ✅     | Cloud Run                                                                          |

## §8 — Auditability

| Control                                                         | Status    | Reference                                                                                      |
| --------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------- |
| §8.1 Recorded events                                            | ✅        | `src/auth/audit-logger.ts` — tool calls, guardrails, admin actions                             |
| §8.2 Tamper evidence (chained SHA-256, signed manifest, export) | ✅        | `src/governance/audit-chain.ts` — HMAC/Ed25519 signers, `exportSigned`, `loadFromDisk(strict)` |
| §8.3 Correlation                                                | ✅        | `correlationId` + `sessionId` on every `AuditEvent`                                            |
| §8.4 Retention (7y for regulated)                               | ✅        | BigQuery audit sink + GCS lifecycle (`terraform/modules/bigquery/`)                            |
| §8.5 Independent blast-radius storage                           | ⚠ partial | Sink lands in the same GCP project; move-to-separate-project tracked as follow-up              |

## §11 — Data handling

| Control                                               | Status      | Reference                                                                   |
| ----------------------------------------------------- | ----------- | --------------------------------------------------------------------------- |
| §11.1 Data classification                             | ✅          | `config/policies/data-classification.json`                                  |
| §11.2 Input filters (PII / secret / prompt-injection) | ✅          | `src/security/middleware.ts` + patterns in `content-safety.json`            |
| §11.3 Output filters                                  | ✅          | `src/security/column-masking.ts` (column-level redact/hash/partial/nullify) |
| §11.4 Provider guardrails                             | ⚠ not wired | Model Armor integration scoped for L3 (no LLM served by this repo)          |
| §11.6 Session memory                                  | N/A         | No cross-session memory store in db-mcp                                     |
| §11.7 Data lineage (source versioning)                | ✅          | `src/governance/lineage.ts` + `lineage.sources[]` on `AuditEventSchema`     |
| §11.8 DLP + k-anonymity                               | ✅          | `src/governance/dlp.ts` — `DlpProvider` interface, `enforceKAnonymity`      |

## §12 — Security

| Control                                                            | Status      | Reference                                                                                                  |
| ------------------------------------------------------------------ | ----------- | ---------------------------------------------------------------------------------------------------------- |
| §12.2 Secret hygiene                                               | ✅          | No static keys (WIF); pre-commit secret scan via MegaLinter                                                |
| §12.3 Supply chain (SLSA ≥ L2, signed images, pinned MCP binaries) | ✅          | `.github/workflows/deploy.yml` — cosign keyless + `actions/attest-build-provenance@v2` + trivy + syft SBOM |
| §12.4 Signed artifacts                                             | ✅          | cosign OIDC keyless on every image; chain manifests signed via `audit-chain.ts`                            |
| §12.5 Boundary hardening                                           | ✅          | VPC-SC, egress denylist (terraform)                                                                        |
| §12.6 Managed threat detection                                     | ⚠ follow-up | SCC Agent Engine Threat Detection wiring pending (Preview service)                                         |
| §12.7 Red-teaming                                                  | 📋 process  | Quarterly red-team cadence — runbook in `docs/governance/RED_TEAM.md` (to be authored)                     |

## §13 — Resilience

| Control                            | Status    | Reference                                                                                             |
| ---------------------------------- | --------- | ----------------------------------------------------------------------------------------------------- |
| §13.1 Circuit breakers             | ✅        | `src/governance/circuit-breaker.ts`                                                                   |
| §13.2 Dead-letter queue            | ✅        | `src/governance/dead-letter-queue.ts`                                                                 |
| §13.3 Reconciliation               | ⚠ partial | `src/bigquery/graceful-degradation.ts` covers dep failure; a governance-plane reconciler is follow-up |
| §13.4 Degraded modes (fail-closed) | ✅        | `isToolAllowed` denies on unknown; `AuditChain.loadFromDisk(strict)` raises on break                  |
| §13.5 Idempotency                  | ✅        | request IDs on every tool call metadata                                                               |

## §14 — Human oversight

| Control                                      | Status      | Reference                                                                                |
| -------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------- |
| §14.1 Kill-switch (<1 min, no cred rotation) | ✅          | `src/governance/kill-switch.ts`, wired in `src/mcp/handlers/tool-handlers.ts`            |
| §14.2 Override API                           | ⚠ partial   | halt / resume implemented; full approval-override flow pending                           |
| §14.3 Interactive review                     | N/A         | db-mcp does not host the approval UI                                                     |
| §14.4 Transparency alerts                    | ⚠ follow-up | contextualised alerts wired through OTel + Cloud Monitoring; escalation metadata pending |

## §15 — Incident response

| Control                   | Status       | Reference                                                  |
| ------------------------- | ------------ | ---------------------------------------------------------- |
| §15.1 Incident definition | 📋 process   | `docs/SECURITY.md` + `SECURITY.md`                         |
| §15.2 Runbook             | 📋 follow-up | `docs/governance/runbooks/` to be authored                 |
| §15.3 Forensic guarantees | ✅           | signed audit export via `SecurityAuditLogger.exportSigned` |

## §16 — Change management

| Control                                              | Status | Reference                                                                                      |
| ---------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------- |
| §16.1 Version control (policies, prompts, contracts) | ✅     | All in git under `config/policies/` + `docs/governance/`                                       |
| §16.2 Review gates                                   | ✅     | `CODEOWNERS`-style PR review (enforce on platform team for `config/policies/**`)               |
| §16.3 Pre-flight CI                                  | ✅     | `.github/workflows/governance.yml` — policy schema + boundary contract + governance unit tests |
| §16.4 Staged rollout                                 | ✅     | dev → staging → prod envs in `terraform/environments/`                                         |
| §16.6 Fine-tuning governance                         | N/A    | No tuned models in this repo                                                                   |

## §19 — Minimum compliance checklist (subset applicable)

- [x] Single enforcement point for all tool calls — `ToolHandlerFactory.execute`
- [x] `defaultAllow = false` in production — `tool-governance.json`
- [x] Policy schema-validated at load — `policy.ts`
- [x] Per-agent identity via WIF
- [x] Chained checksum audit; chain-break load-time error
- [x] Daily signed manifest
- [x] `exportSigned` available
- [x] Kill-switch halts a session in < 1 min
- [x] Retrieval sources versioned on consuming audit entries
- [x] Container images signed (cosign keyless)
- [x] SLSA L2+ build provenance attested
- [x] PR merge gate: policy schema + regression eval
- [ ] Independent-blast-radius audit storage (separate GCP project)
- [ ] Managed threat detection (SCC Agent Engine TD) — Preview, pending GA
- [ ] Quarterly red-team exercise — process owner assignment pending
- [ ] Fairness eval — N/A (non-allocative)

## Open follow-ups

1. Move audit sink to a dedicated blast-radius project (§8.5).
2. Wire SCC Agent Engine Threat Detection once out of Preview (§12.6).
3. Author `docs/governance/runbooks/` per incident class (§15.2).
4. Runtime enforcement of per-tool budgets from `tool-governance.json` (§4.4).
5. Schedule quarterly red-team exercise (§12.7).
