output "mcp_service_account_email" {
  description = "Email of the MCP server service account"
  value       = google_service_account.mcp_server.email
}

output "mcp_service_account_id" {
  description = "ID of the MCP server service account"
  value       = google_service_account.mcp_server.id
}

output "mcp_service_account_name" {
  description = "Name of the MCP server service account"
  value       = google_service_account.mcp_server.name
}

output "bigquery_service_account_email" {
  description = "Email of the BigQuery service account"
  value       = google_service_account.bigquery.email
}

output "bigquery_service_account_id" {
  description = "ID of the BigQuery service account"
  value       = google_service_account.bigquery.id
}

output "bigquery_service_account_name" {
  description = "Name of the BigQuery service account"
  value       = google_service_account.bigquery.name
}

output "deny_policy_id" {
  description = "Deny policy ID (null when disabled)"
  value       = var.enable_deny_policies ? google_iam_deny_policy.bq_sa_no_writes[0].id : null
}

output "pab_policy_id" {
  description = "PAB policy ID (null when no organization_id)"
  value       = var.organization_id != "" ? google_iam_principal_access_boundary_policy.home_project_only[0].id : null
}
