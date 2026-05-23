/**
 * Security event log routing.
 *
 * Routes high-severity Cloud Run security events to a dedicated BigQuery
 * dataset for analysis. The 90-day table expiration has been removed so
 * security events are retained for the compliance window.
 *
 * Long-term Cloud Audit Log retention (Admin Activity + Data Access) is
 * handled centrally in terraform/audit-logging.tf via a 7-year log bucket.
 */

resource "google_bigquery_dataset" "security_logs" {
  dataset_id  = "mcp_security_logs_${var.environment}"
  project     = var.project_id
  location    = var.bigquery_location
  description = "Security event logs for the MCP BigQuery server (${var.environment})"

  # No default_table_expiration_ms: security events must be retained.

  labels = {
    environment = var.environment
    purpose     = "security-logs"
    managed-by  = "terraform"
  }
}

resource "google_logging_project_sink" "mcp_security_logs" {
  name        = "mcp-bigquery-security-logs-${var.environment}"
  project     = var.project_id
  destination = "bigquery.googleapis.com/projects/${var.project_id}/datasets/${google_bigquery_dataset.security_logs.dataset_id}"

  filter = <<-EOT
    resource.type="cloud_run_revision"
    resource.labels.service_name="${local.service_name}"
    (
      jsonPayload.securityEvent=true OR
      jsonPayload.severity="critical" OR
      jsonPayload.severity="high"
    )
  EOT

  unique_writer_identity = true

  bigquery_options {
    use_partitioned_tables = true
  }
}

resource "google_bigquery_dataset_iam_member" "log_sink_writer" {
  dataset_id = google_bigquery_dataset.security_logs.dataset_id
  project    = var.project_id
  role       = "roles/bigquery.dataEditor"
  member     = google_logging_project_sink.mcp_security_logs.writer_identity
}
