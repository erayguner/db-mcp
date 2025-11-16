# Workload Identity Federation Outputs
output "workload_identity_pool_id" {
  description = "The ID of the Workload Identity Pool"
  value       = module.workload_identity_federation.pool_id
}

output "workload_identity_pool_name" {
  description = "The name of the Workload Identity Pool"
  value       = module.workload_identity_federation.pool_name
}

output "workspace_provider_id" {
  description = "The ID of the Google Workspace OIDC provider"
  value       = module.workload_identity_federation.workspace_provider_id
}

output "github_provider_id" {
  description = "The ID of the GitHub Actions OIDC provider"
  value       = module.workload_identity_federation.github_provider_id
}

output "workspace_provider_name" {
  description = "The name of the Google Workspace OIDC provider"
  value       = module.workload_identity_federation.workspace_provider_name
}

# Service Account Outputs
output "mcp_service_account_email" {
  description = "Email of the MCP server service account"
  value       = module.iam.mcp_service_account_email
}

output "mcp_service_account_id" {
  description = "ID of the MCP server service account"
  value       = module.iam.mcp_service_account_id
}

output "bigquery_service_account_email" {
  description = "Email of the BigQuery service account"
  value       = module.iam.bigquery_service_account_email
}

# BigQuery Outputs
output "bigquery_dataset_ids" {
  description = "Map of BigQuery dataset IDs"
  value       = module.bigquery.dataset_ids
}

output "bigquery_dataset_self_links" {
  description = "Map of BigQuery dataset self links"
  value       = module.bigquery.dataset_self_links
}

# Cloud Run Outputs
output "cloud_run_service_url" {
  description = "URL of the Cloud Run service"
  value       = module.cloud_run.service_url
  sensitive   = false
}

output "cloud_run_service_name" {
  description = "Name of the Cloud Run service"
  value       = module.cloud_run.service_name
}

output "cloud_run_service_id" {
  description = "ID of the Cloud Run service"
  value       = module.cloud_run.service_id
}

# Networking Outputs
output "vpc_id" {
  description = "ID of the VPC network"
  value       = module.networking.vpc_id
}

output "vpc_connector_id" {
  description = "ID of the VPC Serverless Connector"
  value       = module.networking.vpc_connector_id
}

output "cloud_armor_policy_id" {
  description = "ID of the Cloud Armor security policy"
  value       = module.networking.cloud_armor_policy_id
}

# Monitoring Outputs
output "monitoring_dashboard_url" {
  description = "URL of the Cloud Monitoring dashboard"
  value       = module.monitoring.dashboard_url
}

output "alert_policy_ids" {
  description = "List of alert policy IDs"
  value       = module.monitoring.alert_policy_ids
}

# Authentication Instructions
output "authentication_instructions" {
  description = "Instructions for authenticating with Workload Identity Federation"
  value       = <<-EOT
    # Authenticate using Workload Identity Federation

    ## Google Workspace Users:
    gcloud auth login --enable-gdrive-access
    gcloud config set project ${var.project_id}

    ## GitHub Actions:
    Use the following in your workflow:

    - uses: google-github-actions/auth@v2
      with:
        workload_identity_provider: ${module.workload_identity_federation.workspace_provider_name}
        service_account: ${module.iam.mcp_service_account_email}

    ## MCP Server URL:
    ${module.cloud_run.service_url}

    ## BigQuery Datasets:
    ${jsonencode(module.bigquery.dataset_ids)}
  EOT
}
