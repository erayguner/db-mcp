# Per-environment Terraform configuration

Each environment (`dev`, `staging`, `prod`) has its own:

- **`terraform.tfvars`** — environment-specific variable values
- **`backend.conf`** — state backend configuration (bucket + prefix)

## First-time setup

```bash
# Bootstrap the state bucket (one-time, with local state)
cd terraform
terraform init   # local backend
terraform apply \
  -var-file=environments/prod/terraform.tfvars \
  -var=create_state_bucket=true \
  -var=state_bucket_name=tf-state-mcp-bigquery-PROJECT_ID \
  -target=google_storage_bucket.terraform_state

# Migrate state to GCS
terraform init \
  -backend-config=environments/prod/backend.conf \
  -migrate-state
```

## Day-to-day

```bash
# Re-init when switching environments (different backend prefix)
terraform init -backend-config=environments/<env>/backend.conf -reconfigure

# Plan / apply
terraform plan  -var-file=environments/<env>/terraform.tfvars
terraform apply -var-file=environments/<env>/terraform.tfvars
```

## Required substitutions

Each `terraform.tfvars` contains placeholders that MUST be set before applying:

- `project_id` — the GCP project
- `workspace_domain` — your Workspace domain (for WIF scoping)
- `github_org` / `github_repo` / `github_repository_owner_id` — the deploy repo
- `mcp_server_image` — bootstrap image (digest-pinned). After first apply, CI updates this.
- `notification_channels.alert_email` — on-call email
- `organization_id` (optional) — for PAB policies. Empty disables them.

## Notes

- **Secrets** must NEVER be in tfvars. Use Secret Manager + module/data references, or pass via `-var` from a secure source.
- **State bucket** is multi-region (default `EU`). Survives regional outages.
- **Per-env state prefix** prevents one environment's apply from touching another.
