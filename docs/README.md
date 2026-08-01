# MCP BigQuery Server — documentation

An enterprise MCP server for Google Cloud BigQuery, with keyless authentication via Workload Identity Federation.

This documentation follows [Diátaxis](https://diataxis.fr/). Four sections, four different needs — pick the one that
matches what you are doing right now.

|                           | Learning                                         | Working                                           |
| ------------------------- | ------------------------------------------------ | ------------------------------------------------- |
| **Practical steps**       | 📚 [Tutorials](tutorials/)<br>Get to know it     | 🔧 [How-to guides](how-to/)<br>Get something done |
| **Theoretical knowledge** | 💡 [Explanation](explanation/)<br>Understand why | 📖 [Reference](reference/)<br>Look something up   |

---

## Start here

**New to this server?** → [Tutorial 1 — Run the server and talk to it](tutorials/01-run-the-server-locally.md)

Ten minutes, no Google Cloud account, and you will have held a complete MCP conversation with it.

**Know what you need?** Jump to the task:

| I want to…                             | Go to                                                                                   |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| Run it locally                         | [Tutorial 1](tutorials/01-run-the-server-locally.md)                                    |
| Run it as a web service                | [Tutorial 2](tutorials/02-serve-over-http.md)                                           |
| Connect it to my own BigQuery project  | [Tutorial 3](tutorials/03-query-your-own-data.md)                                       |
| Restrict what a caller can see         | [Configure a tenant](how-to/configure-a-tenant.md)                                      |
| Hide PII from the model                | [Mask sensitive columns](how-to/mask-sensitive-columns.md)                              |
| Stop runaway query costs               | [Tune the cost guardrail](how-to/tune-the-cost-guardrail.md)                            |
| Require authentication                 | [Enable OIDC authentication](how-to/enable-oidc-authentication.md)                      |
| Deploy to Cloud Run                    | [Deploy with Terraform](how-to/deploy-with-terraform.md)                                |
| Use it from Gemini Enterprise          | [Register with Gemini Enterprise](how-to/register-with-gemini-enterprise.md)            |
| Set up dashboards and alerts           | [Set up monitoring and alerts](how-to/set-up-monitoring-and-alerts.md)                  |
| Work out why something is broken       | [Troubleshoot the server](how-to/troubleshoot-the-server.md)                            |
| Know what a tool accepts and returns   | [MCP tools](reference/mcp-tools.md)                                                     |
| Know what an environment variable does | [Environment variables](reference/environment-variables.md)                             |
| Understand the keyless auth design     | [About Workload Identity Federation](explanation/about-workload-identity-federation.md) |

---

## 📚 [Tutorials](tutorials/)

Lessons that teach the server by using it. Take them in order.

1. [Run the server and talk to it](tutorials/01-run-the-server-locally.md) — stdio, no credentials needed
2. [Serve the same server over HTTP](tutorials/02-serve-over-http.md) — health, metrics, `POST /mcp`
3. [Query your own BigQuery data](tutorials/03-query-your-own-data.md) — real data, dry runs, the cost gate

## 🔧 [How-to guides](how-to/)

Directions for a specific goal.

**Configure** — [tenants](how-to/configure-a-tenant.md) · [column masking](how-to/mask-sensitive-columns.md) ·
[cost guardrail](how-to/tune-the-cost-guardrail.md) · [OIDC](how-to/enable-oidc-authentication.md)

**Deploy** — [container](how-to/build-and-run-the-container.md) · [Terraform](how-to/deploy-with-terraform.md) ·
[Gemini Enterprise](how-to/register-with-gemini-enterprise.md)

**Operate** — [monitoring](how-to/set-up-monitoring-and-alerts.md) ·
[troubleshooting](how-to/troubleshoot-the-server.md)

**Query** — [dataset discovery](how-to/discover-datasets.md) · [multiple projects](how-to/query-multiple-projects.md)

**Develop** — [test suite](how-to/run-the-test-suite.md)

## 📖 [Reference](reference/)

Authoritative descriptions, derived from source.

**MCP** — [tools](reference/mcp-tools.md) · [resources](reference/mcp-resources.md) ·
[prompts](reference/mcp-prompts.md) · [compliance matrix](reference/mcp-compliance-matrix.md)

**Configuration** — [environment variables](reference/environment-variables.md) ·
[tenant configuration](reference/tenant-configuration.md) · [npm scripts](reference/npm-scripts.md)

**Runtime** — [HTTP endpoints](reference/http-endpoints.md) ·
[health and readiness probes](reference/health-and-readiness-probes.md)

## 💡 [Explanation](explanation/)

Why it is built this way.

**Architecture** — [the nine-part set](explanation/architecture/), from system overview to disaster recovery

**Identity** — [Workload Identity Federation](explanation/about-workload-identity-federation.md) ·
[authentication](explanation/about-authentication.md) · [WIF security model](explanation/wif-security-model.md)

**Security** — [the middleware](explanation/about-security.md) · [defence layers](explanation/security-layers.md)

**Performance** — [query optimization and caching](explanation/query-optimization-and-caching.md) ·
[connection pooling](explanation/connection-pooling-design.md)

---

## Documentation that lives elsewhere

Some documentation sits next to the code it describes:

| Location                           | Contents                                   |
| ---------------------------------- | ------------------------------------------ |
| `terraform/README.md`              | Terraform modules, variables, outputs.     |
| `terraform/environments/README.md` | Per-environment configuration.             |
| `deployment/README.md`             | Release and rollback procedure.            |
| `tests/README.md`                  | Test layout and conventions.               |
| `docs/governance/CONFORMANCE.md`   | Governance framework conformance evidence. |
| `CONTRIBUTING.md`                  | Contribution workflow.                     |
| `SECURITY.md`                      | Vulnerability disclosure policy.           |
| `CHANGELOG.md`                     | Release history.                           |

---

## Contributing to these docs

Each page belongs to exactly one Diátaxis category. Before adding content, decide which need it serves:

| If the reader is…              | Write…      | And avoid…                                  |
| ------------------------------ | ----------- | ------------------------------------------- |
| learning by doing              | a tutorial  | choices, alternatives, extended explanation |
| trying to accomplish something | a how-to    | teaching, completeness for its own sake     |
| looking something up           | reference   | instruction, opinion, persuasion            |
| trying to understand           | explanation | step-by-step instructions, API listings     |

Mixing types in one page is the most common way documentation degrades. If a page is doing two jobs, split it.

Verify commands and configuration values against the source before documenting them — the
[reference index](reference/README.md#where-these-facts-come-from) lists which file is authoritative for each area.

## External resources

- [Model Context Protocol specification](https://modelcontextprotocol.io)
- [Workload Identity Federation](https://cloud.google.com/iam/docs/workload-identity-federation)
- [BigQuery API reference](https://cloud.google.com/bigquery/docs/reference)
- [Cloud Run documentation](https://cloud.google.com/run/docs)
- [Diátaxis](https://diataxis.fr/)
