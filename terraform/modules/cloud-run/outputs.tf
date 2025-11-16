output "service_name" {
  description = "Cloud Run service name"
  value       = google_cloud_run_service.mcp_server.name
}

output "service_url" {
  description = "Cloud Run service URL"
  value       = google_cloud_run_service.mcp_server.status[0].url
}

output "service_id" {
  description = "Cloud Run service ID"
  value       = google_cloud_run_service.mcp_server.id
}

output "latest_revision_name" {
  description = "Latest Cloud Run revision name"
  value       = google_cloud_run_service.mcp_server.status[0].latest_ready_revision_name
}

output "domain_mapping_name" {
  description = "Custom domain mapping name"
  value       = var.custom_domain != "" ? google_cloud_run_domain_mapping.mcp_domain[0].name : null
}

output "backend_service_id" {
  description = "Load Balancer backend service ID"
  value       = var.cloud_armor_policy_id != null ? google_compute_backend_service.mcp_backend[0].id : null
}

output "global_ip_address" {
  description = "Global load balancer IP address"
  value       = var.cloud_armor_policy_id != null && var.ssl_certificate_id != "" ? google_compute_global_forwarding_rule.mcp_https[0].ip_address : null
}

output "security_logs_dataset_id" {
  description = "BigQuery dataset ID for security logs"
  value       = google_bigquery_dataset.security_logs.dataset_id
}

output "security_logs_sink_name" {
  description = "Cloud Logging sink name for security logs"
  value       = google_logging_project_sink.mcp_security_logs.name
}
