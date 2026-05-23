# Deployment — BigQuery MCP Server

## Single source of truth

**Terraform** (`terraform/`) is the authoritative definition of every GCP resource: Cloud Run service, IAM, Artifact
Registry, Workload Identity Federation, Binary Authorization, KMS, Cloud Logging buckets, VPC, Cloud Armor, and the
optional VPC Service Controls perimeter.

The Cloud Run service is created and shaped by Terraform once (`terraform apply`); subsequent **image** updates are
pushed by CI via `gcloud run services update --image`. Terraform's `lifecycle.ignore_changes` on the image field
prevents `terraform apply` from reverting CI's image deployments — Terraform owns the service config, CI owns the image.

The legacy `deploy.sh` and `cloud-run.yaml` were removed because they diverged from Terraform (wrong service name, wrong
region `us-central1`, `--allow-unauthenticated`, manual IAM creation).

## How a release gets deployed

```
git push → main
  └─ GitHub Actions (.github/workflows/deploy.yml)
       ├─ lint / typecheck / test (parallel)
       └─ build-sign-push
       │    ├─ Build image → europe-west2-docker.pkg.dev/<project>/db-mcp/mcp-bigquery-server:<sha>
       │    ├─ Push to Artifact Registry (resolves digest)
       │    ├─ Generate SBOM (syft / CycloneDX)
       │    ├─ Vulnerability scan (trivy — blocks on CRITICAL/HIGH)
       │    ├─ Sign with KMS-backed cosign key (BinAuth attestor verifies)
       │    └─ Attach SLSA build provenance
       └─ deploy
            └─ gcloud run services update mcp-bigquery-server-prod \
                  --image <digest-pinned-ref> \
                  --region europe-west2
```

Deployments always reference the image by **digest** (not mutable tag) so that the Binary Authorization policy can
verify the cosign signature.

## Image naming convention

```
europe-west2-docker.pkg.dev/<PROJECT_ID>/db-mcp/mcp-bigquery-server:<git-sha>
europe-west2-docker.pkg.dev/<PROJECT_ID>/db-mcp/mcp-bigquery-server@sha256:<digest>
```

## Environment service names (managed by Terraform)

| Environment | Cloud Run service name        |
| ----------- | ----------------------------- |
| dev         | `mcp-bigquery-server-dev`     |
| staging     | `mcp-bigquery-server-staging` |
| prod        | `mcp-bigquery-server-prod`    |

Region: `europe-west2` for all environments. BigQuery datasets live in the `EU` multi-region. KMS keys live in the
`europe` multi-region to match.

## Viewing logs

```bash
gcloud logging tail \
  'resource.type=cloud_run_revision AND resource.labels.service_name=mcp-bigquery-server-prod' \
  --project=<PROJECT_ID>
```

## Rolling back

Cloud Run keeps the previous revisions automatically:

```bash
# List recent revisions
gcloud run revisions list --service=mcp-bigquery-server-prod --region=europe-west2

# Roll traffic back to a previous revision
gcloud run services update-traffic mcp-bigquery-server-prod \
  --to-revisions=<previous-revision>=100 \
  --region=europe-west2
```

## Optional: Cloud Deploy progressive delivery

`clouddeploy.yaml` and `skaffold.yaml` at the repo root are **scaffolding for future Cloud Deploy adoption**, not active
in the current CI flow. To enable progressive (canary 25 → 50 → 100) promotion with manual approvals:

1. Generate per-environment Cloud Run manifests (Terraform does not currently produce these; doing so reintroduces a
   multiple-sources-of- truth problem unless Cloud Deploy's manifest ownership is carved out from Terraform first).
2. `gcloud deploy apply --file=clouddeploy.yaml` to register the pipeline and targets.
3. Replace the `deploy` job in `.github/workflows/deploy.yml` with `gcloud deploy releases create …`.
4. Grant `roles/clouddeploy.releaser` to the CI service account.

This is intentionally NOT the default path — see ADR (to be written) for the trade-offs between Terraform-owned Cloud
Run config and Cloud-Deploy-owned manifests.
