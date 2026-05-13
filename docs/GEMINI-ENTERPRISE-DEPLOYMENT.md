# Gemini Enterprise Custom MCP Connector — Deployment Runbook

This runbook walks through publishing the BigQuery MCP server as a custom data connector for **Gemini Enterprise** per
the Google Cloud
[Set up a custom MCP server](https://docs.cloud.google.com/gemini/enterprise/docs/connectors/custom-mcp-server/set-up-custom-mcp-server)
documentation.

> **Audience**: platform engineers deploying this server to Cloud Run for an organization that will register it inside
> Gemini Enterprise / Vertex AI Search.

## 1. Prerequisites

- A GCP project with the **Discovery Engine API** enabled.
- An OAuth 2.0 identity provider — Google Workspace, Okta, or Azure AD — with permission to register a new OAuth client.
- The MCP server already deployable to Cloud Run (see [DOCKER-DEPLOYMENT.md](DOCKER-DEPLOYMENT.md)).
- The operator running the registration holds `roles/discoveryengine.editor`.

## 2. Required transport configuration

Gemini Enterprise **only supports Streamable HTTP** for custom MCP servers. Enable strict mode so the server returns
`405 Method Not Allowed` for SSE `GET /mcp` upgrade attempts.

```bash
MCP_TRANSPORT=http
MCP_TRANSPORT_STRICT=streamable
```

Verification:

```bash
curl -i https://<your-mcp-host>/mcp
# Expect: HTTP/1.1 405 Method Not Allowed
# Allow: POST
```

## 3. OAuth 2.0 configuration

### 3.1 Register an OAuth client with your IdP

When registering, set the redirect URI to the Vertex AI Search well-known value:

```
https://vertexaisearch.cloud.google.com/oauth-redirect
```

Note the **client ID** and **client secret** — you'll paste these into Gemini Enterprise during data-store creation.

### 3.2 Configure OAuth metadata env vars

The server publishes RFC 8414 and RFC 9728 discovery documents when these variables are set. Gemini Enterprise (and any
other 2025-06-18-compliant MCP client) uses them to discover the bound authorization server.

```bash
# Public base URL of the MCP server, used as the protected-resource identifier.
OAUTH_RESOURCE_URL=https://mcp.example.com

# Authorization-server issuer (Google example shown).
OAUTH_ISSUER=https://accounts.google.com
OAUTH_AUTHORIZATION_ENDPOINT=https://accounts.google.com/o/oauth2/v2/auth
OAUTH_TOKEN_ENDPOINT=https://oauth2.googleapis.com/token
OAUTH_JWKS_URI=https://www.googleapis.com/oauth2/v3/certs

# Space-separated scopes that the resource server enforces.
OAUTH_SCOPES_SUPPORTED="mcp.read mcp.invoke"

# Optional — defaults to OAUTH_RESOURCE_URL.
OAUTH_RESOURCE_AUDIENCE=https://mcp.example.com

# Optional — dynamic-client-registration endpoint per RFC 7591.
# OAUTH_REGISTRATION_ENDPOINT=...
```

### 3.3 Verify discovery endpoints

```bash
curl -s https://mcp.example.com/.well-known/oauth-authorization-server | jq .
curl -s https://mcp.example.com/.well-known/oauth-protected-resource | jq .
```

Both documents must return JSON. The protected-resource document must include `resource`, `authorization_servers`,
`bearer_methods_supported`, and `scopes_supported`.

### 3.4 Verify the 401 contract

Unauthenticated requests must include `WWW-Authenticate` with a `resource_metadata` parameter pointing at the
protected-resource document. After wiring `sendUnauthorized()` into your auth middleware:

```bash
curl -i https://mcp.example.com/mcp -X POST -d '{}'
# Expect:
#   HTTP/1.1 401 Unauthorized
#   WWW-Authenticate: Bearer realm="mcp", error="invalid_token",
#     resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource"
```

## 4. Register the connector in Gemini Enterprise

In the Google Cloud console:

1. **Agent Builder → Data stores → Create data store → Custom MCP server**.
2. Fill in:
   - **MCP Server URL**: `https://mcp.example.com/mcp`
   - **Authorization URL**: value of `OAUTH_AUTHORIZATION_ENDPOINT`
   - **Token URL**: value of `OAUTH_TOKEN_ENDPOINT`
   - **Client ID** / **Client Secret**: from §3.1
   - **Scopes**: `mcp.read mcp.invoke` (space-separated)
   - **Description**: e.g. "BigQuery query + catalog browse"
3. Gemini will perform a `tools/list` probe — confirm the four tools (`query_bigquery`, `list_datasets`, `list_tables`,
   `get_table_schema`) appear in the registration summary.

## 5. Native MCP features clients can rely on

| Feature                | How clients invoke it                                         |
| ---------------------- | ------------------------------------------------------------- |
| **Tools**              | `tools/list`, `tools/call`                                    |
| **Static resources**   | `resources/list` → `bigquery://datasets`                      |
| **Resource templates** | `resources/templates/list` → URI templates §§ below           |
| **Prompts**            | `prompts/list`, `prompts/get`                                 |
| **Cost elicitation**   | Returned via `_meta.requiresConfirmation` on `query_bigquery` |

Resource templates exposed:

- `bigquery://datasets/{datasetId}`
- `bigquery://datasets/{datasetId}/tables/{tableId}`
- `bigquery://datasets/{datasetId}/tables/{tableId}/schema`
- `bigquery://datasets/{datasetId}/tables/{tableId}/sample`
- `bigquery://jobs/{jobId}`
- `bigquery://datasets/{datasetId}/information_schema/{view}`

## 6. Cost-guardrail tuning

The `query_bigquery` tool runs a dry-run before execution. Tune via env:

```bash
MCP_COST_ELICITATION_ENABLED=true            # turn the gate on/off
MCP_COST_ELICITATION_BYTES=10737418240        # 10 GiB default
MCP_BQ_USD_PER_TIB=6.25                       # BigQuery on-demand US pricing
```

When a query exceeds the threshold, the response contains:

```json
{
  "status": "requires_confirmation",
  "reason": "cost_threshold_exceeded",
  "estimate": {
    "totalBytesProcessed": 53687091200,
    "estimatedCostUSD": 0.32,
    "thresholdBytes": 10737418240
  }
}
```

…and `_meta.elicitation.proceedArgs = { confirmCost: true }`. The client displays the prompt, gathers consent, and
re-invokes the tool with `confirmCost: true`.

## 7. Smoke test checklist

Run these against the deployed Cloud Run service before submitting the connector for Gemini Enterprise registration:

- [ ] `GET /health` returns 200.
- [ ] `GET /.well-known/oauth-authorization-server` returns RFC 8414 JSON.
- [ ] `GET /.well-known/oauth-protected-resource` returns RFC 9728 JSON.
- [ ] `GET /mcp` returns 405 with `Allow: POST` (strict mode).
- [ ] Unauthenticated `POST /mcp` returns 401 with `WWW-Authenticate`.
- [ ] Authenticated `POST /mcp` with `{"method": "tools/list"}` enumerates the four tools and their annotations
      (`readOnlyHint`, `costHintTier`).
- [ ] Authenticated `POST /mcp` with `{"method": "resources/templates/list"}` returns the six BigQuery resource
      templates.

## 8. Known limitations

- VPC Service Controls integration is not supported by Gemini Enterprise in the current preview.
- PSC ingress is not supported by Gemini Enterprise; this server can be deployed behind PSC for other clients, but the
  Gemini connector requires public HTTPS.
- The `sendUnauthorized()` helper exists on the transport but is **not yet wired into the request pipeline**; auth
  middleware integration is tracked as follow-up work.

## 9. References

- Spec:
  [MCP 2025-06-18 authorization](https://spec.modelcontextprotocol.io/specification/2025-06-18/basic/authorization/)
- RFC 8414 — OAuth 2.0 Authorization Server Metadata
- RFC 9728 — OAuth 2.0 Protected Resource Metadata
- [Gemini Enterprise — Set up a custom MCP server](https://docs.cloud.google.com/gemini/enterprise/docs/connectors/custom-mcp-server/set-up-custom-mcp-server)
