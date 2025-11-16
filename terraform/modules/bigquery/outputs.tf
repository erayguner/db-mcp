output "dataset_ids" {
  description = "Map of dataset IDs"
  value = {
    for k, v in google_bigquery_dataset.datasets : k => v.dataset_id
  }
}

output "dataset_self_links" {
  description = "Map of dataset self links"
  value = {
    for k, v in google_bigquery_dataset.datasets : k => v.self_link
  }
}

output "kms_key_id" {
  description = "KMS key ID used for dataset encryption"
  value       = google_kms_crypto_key.bigquery.id
}

output "audit_dataset_id" {
  description = "Audit logs dataset ID"
  value       = var.enable_audit_logging ? google_bigquery_dataset.audit_logs[0].dataset_id : null
}

output "audit_table_id" {
  description = "Audit logs table ID"
  value       = var.enable_audit_logging ? google_bigquery_table.access_log[0].table_id : null
}
