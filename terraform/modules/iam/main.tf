/**
 * IAM Module — Service Accounts and Bindings
 *
 * NO SERVICE ACCOUNT KEYS — Workload Identity Federation only.
 *
 * Changes from the previous design:
 *   - Removed project-level roles/bigquery.dataEditor on the BigQuery SA
 *     (the MCP tools are read-only; write perms violated least privilege).
 *   - Removed the custom role with tables.create / tables.updateData /
 *     tables.getData (write permissions on a read-only server).
 *   - Removed project-wide roles/secretmanager.secretAccessor — now
 *     granted per-secret in the cloud-run module.
 *   - Replaced wildcard principalSet bindings (attribute.hd/*,
 *     attribute.repository_owner/*) with domain/repo-scoped bindings.
 *   - Removed the broken google_service_account_iam_member.cloud_run_invoker
 *     (roles/run.invoker on a SA does not grant Cloud Run invocation;
 *     the cloud-run module handles invoker IAM on the service itself).
 *
 * Deny and PAB policies live in deny.tf and pab.tf respectively.
 */

locals {
  mcp_sa_name      = "mcp-server-${var.environment}"
  bigquery_sa_name = "mcp-bigquery-${var.environment}"
}

# Runtime service account for the Cloud Run service.
resource "google_service_account" "mcp_server" {
  project      = var.project_id
  account_id   = local.mcp_sa_name
  display_name = "MCP Server Service Account - ${upper(var.environment)}"
  description  = "Runtime SA for the MCP BigQuery server (${var.environment})"
}

# Data-tier service account — the MCP SA impersonates this account for
# BigQuery operations. Keeping a separate data-tier identity preserves
# the audit boundary between the web tier and the data tier.
resource "google_service_account" "bigquery" {
  project      = var.project_id
  account_id   = local.bigquery_sa_name
  display_name = "MCP BigQuery Service Account - ${upper(var.environment)}"
  description  = "Data-tier SA for BigQuery operations (${var.environment})"
}

# --- Workload Identity Federation bindings (domain/repo-scoped) ---

# Google Workspace users in the specified hosted domain may impersonate
# the MCP SA. Previously this was attribute.hd/* — any Workspace tenant.
resource "google_service_account_iam_member" "workspace_wif_binding" {
  count              = var.workspace_domain != "" ? 1 : 0
  service_account_id = google_service_account.mcp_server.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${var.workload_identity_pool_id}/attribute.hd/${var.workspace_domain}"
}

# GitHub Actions in the specified repository may impersonate the MCP SA.
# Previously this was attribute.repository_owner/* — any GitHub org/user.
resource "google_service_account_iam_member" "github_wif_binding" {
  count              = var.github_provider_id != null && var.github_repository != "" ? 1 : 0
  service_account_id = google_service_account.mcp_server.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${var.workload_identity_pool_id}/attribute.repository/${var.github_repository}"
}

# --- Service account impersonation boundary ---
# The MCP SA can mint short-lived access tokens for the BigQuery SA.
# Combined with deny.tf, this gives genuine defense-in-depth: an attacker
# who lands on the MCP SA must additionally exercise the token-creator
# grant to reach BigQuery, and that impersonation is separately audited.
resource "google_service_account_iam_member" "mcp_impersonate_bigquery" {
  service_account_id = google_service_account.bigquery.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.mcp_server.email}"
}

# --- MCP Server SA: project-level roles ---
resource "google_project_iam_member" "mcp_server_roles" {
  for_each = toset([
    "roles/bigquery.jobUser",        # Create BigQuery jobs (in this project)
    "roles/logging.logWriter",       # Write structured logs
    "roles/monitoring.metricWriter", # Write metrics
    "roles/cloudtrace.agent",        # Write traces
    # roles/secretmanager.secretAccessor is granted per-secret in cloud-run/main.tf
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.mcp_server.email}"
}

# --- BigQuery SA: project-level roles (read-only / job-runner) ---
# Note: dataset-scoped roles/bigquery.dataViewer are granted by the bigquery
# module via tenant_dataset_bindings. Project-level dataEditor has been
# REMOVED (it was over-privileged for a read-only MCP server).
resource "google_project_iam_member" "bigquery_sa_roles" {
  for_each = toset([
    "roles/bigquery.jobUser",        # Create query jobs
    "roles/bigquery.metadataViewer", # List datasets/tables (without data access)
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.bigquery.email}"
}
