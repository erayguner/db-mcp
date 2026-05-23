output "service_name" {
  description = "Cloud Run service name"
  value       = google_cloud_run_v2_service.mcp_server.name
}

output "service_url" {
  description = "Cloud Run service URL"
  value       = google_cloud_run_v2_service.mcp_server.uri
}

output "service_id" {
  description = "Cloud Run service ID"
  value       = google_cloud_run_v2_service.mcp_server.id
}

output "latest_ready_revision" {
  description = "Latest ready revision name"
  value       = google_cloud_run_v2_service.mcp_server.latest_ready_revision
}

output "neg_id" {
  description = "Serverless NEG ID for this region (always created so a peer cloud-run invocation can wire it as a DR backend)"
  value       = google_compute_region_network_endpoint_group.mcp_neg.id
}

output "backend_service_id" {
  description = "Global external ALB backend service ID"
  value       = var.cloud_armor_policy_id != null ? google_compute_backend_service.mcp_backend[0].id : null
}

output "global_ip_address" {
  description = "Global load balancer IP address"
  value       = (var.cloud_armor_policy_id != null && var.ssl_certificate_id != "") ? google_compute_global_forwarding_rule.mcp_https[0].ip_address : null
}

output "tenant_config_secret_id" {
  description = "Secret Manager secret ID holding tenant configuration"
  value       = google_secret_manager_secret.tenant_config.secret_id
}

output "security_logs_dataset_id" {
  description = "BigQuery dataset ID for security event logs"
  value       = google_bigquery_dataset.security_logs.dataset_id
}

output "security_logs_sink_name" {
  description = "Cloud Logging sink name for security events"
  value       = google_logging_project_sink.mcp_security_logs.name
}

output "psc_service_attachment_id" {
  description = "PSC service attachment ID (null when PSC disabled)"
  value       = var.enable_private_service_connect ? google_compute_service_attachment.mcp_psc[0].id : null
}
