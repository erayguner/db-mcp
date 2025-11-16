/**
 * IAM Module
 *
 * Creates service accounts and IAM bindings for MCP server.
 * NO SERVICE ACCOUNT KEYS - Uses Workload Identity Federation only!
 */

locals {
  mcp_sa_name      = "mcp-server-${var.environment}"
  bigquery_sa_name = "mcp-bigquery-${var.environment}"
}

# MCP Server Service Account (NO KEYS!)
resource "google_service_account" "mcp_server" {
  project      = var.project_id
  account_id   = local.mcp_sa_name
  display_name = "MCP Server Service Account - ${upper(var.environment)}"
  description  = "Service account for MCP server operations (${var.environment})"
}

# BigQuery Service Account (NO KEYS!)
resource "google_service_account" "bigquery" {
  project      = var.project_id
  account_id   = local.bigquery_sa_name
  display_name = "MCP BigQuery Service Account - ${upper(var.environment)}"
  description  = "Service account for BigQuery operations (${var.environment})"
}

# Workload Identity Binding - Google Workspace to MCP SA
resource "google_service_account_iam_member" "workspace_wif_binding" {
  service_account_id = google_service_account.mcp_server.name
  role               = "roles/iam.workloadIdentityUser"

  member = "principalSet://iam.googleapis.com/${var.workload_identity_pool_id}/attribute.hd/*"
}

# Workload Identity Binding - GitHub Actions to MCP SA
resource "google_service_account_iam_member" "github_wif_binding" {
  count = var.github_provider_id != null ? 1 : 0

  service_account_id = google_service_account.mcp_server.name
  role               = "roles/iam.workloadIdentityUser"

  member = "principalSet://iam.googleapis.com/${var.workload_identity_pool_id}/attribute.repository_owner/*"
}

# Service Account Impersonation - MCP SA can impersonate BigQuery SA
resource "google_service_account_iam_member" "mcp_impersonate_bigquery" {
  service_account_id = google_service_account.bigquery.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.mcp_server.email}"
}

# IAM Roles for MCP Server Service Account
resource "google_project_iam_member" "mcp_server_roles" {
  for_each = toset([
    "roles/bigquery.jobUser",             # Create and run BigQuery jobs
    "roles/logging.logWriter",            # Write logs
    "roles/monitoring.metricWriter",      # Write metrics
    "roles/cloudtrace.agent",             # Write traces
    "roles/secretmanager.secretAccessor", # Access secrets
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.mcp_server.email}"
}

# IAM Roles for BigQuery Service Account
resource "google_project_iam_member" "bigquery_roles" {
  for_each = toset([
    "roles/bigquery.dataEditor", # Read and write BigQuery data
    "roles/bigquery.user",       # Use BigQuery
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.bigquery.email}"
}

# Custom IAM Role for Fine-Grained BigQuery Access
resource "google_project_iam_custom_role" "bigquery_mcp_role" {
  project     = var.project_id
  role_id     = "bigqueryMcpRole${title(var.environment)}"
  title       = "BigQuery MCP Role - ${upper(var.environment)}"
  description = "Custom role for MCP BigQuery operations with minimal permissions"

  permissions = [
    "bigquery.datasets.get",
    "bigquery.tables.get",
    "bigquery.tables.list",
    "bigquery.tables.getData",
    "bigquery.tables.updateData",
    "bigquery.tables.create",
    "bigquery.jobs.create",
    "bigquery.jobs.get",
    "bigquery.jobs.list",
  ]
}

# Assign Custom Role to BigQuery Service Account
resource "google_project_iam_member" "bigquery_custom_role" {
  project = var.project_id
  role    = google_project_iam_custom_role.bigquery_mcp_role.id
  member  = "serviceAccount:${google_service_account.bigquery.email}"
}

# Cloud Run Invoker Role (if needed for public access)
resource "google_service_account_iam_member" "cloud_run_invoker" {
  count = var.allow_public_access ? 1 : 0

  service_account_id = google_service_account.mcp_server.name
  role               = "roles/run.invoker"
  member             = "allUsers"
}
