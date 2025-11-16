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

output "custom_role_id" {
  description = "ID of the custom BigQuery IAM role"
  value       = google_project_iam_custom_role.bigquery_mcp_role.id
}
