/**
 * Long-term audit log retention (Cloud Audit Logs).
 *
 * Replaces the project's earlier 90-day BigQuery table expiration on the
 * audit dataset (which actively destroyed evidence). Cloud Audit Logs
 * (Admin Activity, System Event, Policy Denials, and Data Access) are
 * routed to a dedicated Cloud Logging bucket with 2,555-day (7-year)
 * retention. A linked BigQuery dataset gives the same SQL-query surface
 * without paying for BigQuery storage.
 *
 * Data Access audit logs are explicitly enabled — they are OFF by default,
 * and without them the GDPR/SOC2 audit-trail claim has no evidence.
 */

resource "google_logging_project_bucket_config" "audit_7yr" {
  project        = var.project_id
  location       = "global"
  bucket_id      = "audit-7yr-${var.environment}"
  description    = "Cloud Audit Logs retained 7 years (compliance requirement)"
  retention_days = 2555

  enable_analytics = true
}

# Linked BigQuery dataset over the log bucket. No BigQuery ingestion
# storage cost — queries read from Cloud Logging storage in place.
resource "google_logging_linked_dataset" "audit_bq" {
  link_id  = "audit_bq_${var.environment}"
  bucket   = google_logging_project_bucket_config.audit_7yr.id
  location = "global"

  description = "BigQuery-linked dataset for the 7-year audit log bucket"
}

# Sink: route Cloud Audit Logs (activity + data_access + system_event +
# policy) to the long-retention bucket.
resource "google_logging_project_sink" "audit_to_bucket" {
  name        = "mcp-audit-to-bucket-${var.environment}"
  project     = var.project_id
  destination = "logging.googleapis.com/${google_logging_project_bucket_config.audit_7yr.id}"

  # Match all Cloud Audit Log channels.
  filter = "logName=~\"projects/${var.project_id}/logs/cloudaudit.googleapis.com%2F(activity|data_access|system_event|policy)\""

  # The sink writes via its own service identity; granting it bucket
  # writer is automatic for log-bucket destinations.
  unique_writer_identity = true
}

# Enable BigQuery Data Access audit logs (default OFF).
# Required to evidence read/write access in audit trails.
resource "google_project_iam_audit_config" "bigquery_data_access" {
  project = var.project_id
  service = "bigquery.googleapis.com"

  audit_log_config {
    log_type = "ADMIN_READ"
  }
  audit_log_config {
    log_type = "DATA_READ"
  }
  audit_log_config {
    log_type = "DATA_WRITE"
  }
}

# Enable Cloud Run Data Access audit logs (default OFF).
resource "google_project_iam_audit_config" "cloud_run_data_access" {
  project = var.project_id
  service = "run.googleapis.com"

  audit_log_config {
    log_type = "ADMIN_READ"
  }
  audit_log_config {
    log_type = "DATA_READ"
  }
  audit_log_config {
    log_type = "DATA_WRITE"
  }
}

# Enable Secret Manager Data Access audit logs — surfaces every read of
# the tenant-config secret, useful for tenant onboarding/offboarding.
resource "google_project_iam_audit_config" "secret_manager_data_access" {
  project = var.project_id
  service = "secretmanager.googleapis.com"

  audit_log_config {
    log_type = "ADMIN_READ"
  }
  audit_log_config {
    log_type = "DATA_READ"
  }
  audit_log_config {
    log_type = "DATA_WRITE"
  }
}
