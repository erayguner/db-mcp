# Workload Identity Federation Module

locals {
  pool_id          = "mcp-bigquery-pool-${var.environment}"
  full_github_repo = var.github_org != "" && var.github_repo != "" ? "${var.github_org}/${var.github_repo}" : ""
}

# Workload Identity Pool
resource "google_iam_workload_identity_pool" "main" {
  provider                  = google-beta
  project                   = var.project_id
  workload_identity_pool_id = local.pool_id
  display_name              = "MCP BigQuery Server - ${var.environment}"
  description               = "Workload Identity Pool for MCP BigQuery Server authentication (${var.environment})"
  disabled                  = false
}

# Google Workspace OIDC Provider
resource "google_iam_workload_identity_pool_provider" "google_workspace" {
  provider                  = google-beta
  project                   = var.project_id
  workload_identity_pool_id = google_iam_workload_identity_pool.main.workload_identity_pool_id
  count                     = var.workspace_domain != "" ? 1 : 0

  workload_identity_pool_provider_id = "google-workspace-${var.environment}"
  display_name                       = "Google Workspace OIDC - ${var.environment}"
  description                        = "Google Workspace authentication for ${var.workspace_domain}"
  disabled                           = false

  oidc {
    issuer_uri        = "https://accounts.google.com"
    allowed_audiences = var.allowed_audiences
  }

  attribute_mapping = {
    "google.subject"           = "assertion.sub"
    "attribute.email"          = "assertion.email"
    "attribute.email_verified" = "assertion.email_verified"
    "attribute.name"           = "assertion.name"
    "attribute.hd"             = "assertion.hd"
    "attribute.groups"         = "assertion.groups"
  }

  attribute_condition = "assertion.hd == '${var.workspace_domain}' && assertion.email_verified == true"
}

# GitHub Actions OIDC Provider
resource "google_iam_workload_identity_pool_provider" "github" {
  count    = local.full_github_repo != "" ? 1 : 0
  provider = google-beta

  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.main.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-actions-${var.environment}"
  display_name                       = "GitHub Actions OIDC - ${var.environment}"
  description                        = "GitHub Actions authentication for ${local.full_github_repo}"
  disabled                           = false

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }

  attribute_mapping = {
    "google.subject"             = "assertion.sub"
    "attribute.actor"            = "assertion.actor"
    "attribute.repository"       = "assertion.repository"
    "attribute.repository_owner" = "assertion.repository_owner"
    "attribute.workflow"         = "assertion.workflow"
    "attribute.ref"              = "assertion.ref"
  }

  attribute_condition = "assertion.repository == '${local.full_github_repo}'"
}
