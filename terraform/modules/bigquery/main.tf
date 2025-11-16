/**
 * BigQuery Module
 *
 * Creates BigQuery datasets with security best practices:
 * - Customer-managed encryption keys (CMEK)
 * - Access controls and IAM bindings
 * - Audit logging
 * - Table expiration policies
 */

locals {
  # Generate dataset names with environment suffix
  datasets_with_env = {
    for k, v in var.datasets : "${k}_${var.environment}" => v
  }
}

# KMS Key Ring for BigQuery encryption
resource "google_kms_key_ring" "bigquery" {
  name     = "bigquery-${var.environment}"
  location = var.region
  project  = var.project_id
}

# KMS Crypto Key for BigQuery datasets
resource "google_kms_crypto_key" "bigquery" {
  name            = "bigquery-dataset-key"
  key_ring        = google_kms_key_ring.bigquery.id
  rotation_period = "7776000s" # 90 days

  lifecycle {
    prevent_destroy = true
  }
}

# Grant BigQuery service account access to KMS key
resource "google_kms_crypto_key_iam_member" "bigquery_encryption" {
  crypto_key_id = google_kms_crypto_key.bigquery.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${var.service_account}"
}

# BigQuery Datasets
resource "google_bigquery_dataset" "datasets" {
  for_each = local.datasets_with_env

  project       = var.project_id
  dataset_id    = each.key
  friendly_name = title(replace(each.key, "_", " "))
  description   = each.value.description
  location      = each.value.location

  # Delete contents when destroying (only for non-prod)
  delete_contents_on_destroy = each.value.delete_contents_on_destroy

  # Default table expiration
  default_table_expiration_ms = each.value.default_table_expiration_ms

  # Encryption with CMEK
  default_encryption_configuration {
    kms_key_name = google_kms_crypto_key.bigquery.id
  }

  # Labels
  labels = merge(
    each.value.labels,
    {
      environment = var.environment
      managed_by  = "terraform"
    }
  )

  # Access controls - handled separately via IAM

  depends_on = [google_kms_crypto_key_iam_member.bigquery_encryption]
}

# Dataset IAM Bindings
resource "google_bigquery_dataset_iam_member" "service_account_data_editor" {
  for_each = google_bigquery_dataset.datasets

  project    = var.project_id
  dataset_id = each.value.dataset_id
  role       = "roles/bigquery.dataEditor"
  member     = "serviceAccount:${var.service_account}"
}

resource "google_bigquery_dataset_iam_member" "service_account_user" {
  for_each = google_bigquery_dataset.datasets

  project    = var.project_id
  dataset_id = each.value.dataset_id
  role       = "roles/bigquery.user"
  member     = "serviceAccount:${var.service_account}"
}

# Audit Logging Configuration
resource "google_bigquery_dataset_access" "audit_logs" {
  for_each = var.enable_audit_logging ? google_bigquery_dataset.datasets : {}

  dataset_id = each.value.dataset_id
  project    = var.project_id

  view {
    project_id = var.project_id
    dataset_id = google_bigquery_dataset.audit_logs[0].dataset_id
    table_id   = google_bigquery_table.access_log[0].table_id
  }
}

# Audit Logs Dataset
resource "google_bigquery_dataset" "audit_logs" {
  count = var.enable_audit_logging ? 1 : 0

  project       = var.project_id
  dataset_id    = "audit_logs_${var.environment}"
  friendly_name = "Audit Logs - ${upper(var.environment)}"
  description   = "Audit logs for BigQuery access"
  location      = var.region

  delete_contents_on_destroy = false

  default_encryption_configuration {
    kms_key_name = google_kms_crypto_key.bigquery.id
  }

  labels = {
    environment = var.environment
    purpose     = "audit_logs"
    managed_by  = "terraform"
  }

  depends_on = [google_kms_crypto_key_iam_member.bigquery_encryption]
}

# Audit Log Table
resource "google_bigquery_table" "access_log" {
  count = var.enable_audit_logging ? 1 : 0

  project    = var.project_id
  dataset_id = google_bigquery_dataset.audit_logs[0].dataset_id
  table_id   = "access_log"

  deletion_protection = true

  time_partitioning {
    type          = "DAY"
    expiration_ms = 7776000000 # 90 days
  }

  schema = jsonencode([
    {
      name        = "timestamp"
      type        = "TIMESTAMP"
      mode        = "REQUIRED"
      description = "Time of access"
    },
    {
      name        = "user_email"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "Email of user accessing data"
    },
    {
      name        = "dataset_id"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "Dataset accessed"
    },
    {
      name        = "table_id"
      type        = "STRING"
      mode        = "NULLABLE"
      description = "Table accessed"
    },
    {
      name        = "operation"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "Type of operation (SELECT, INSERT, UPDATE, DELETE)"
    },
    {
      name        = "row_count"
      type        = "INTEGER"
      mode        = "NULLABLE"
      description = "Number of rows affected"
    }
  ])

  labels = {
    environment = var.environment
    purpose     = "audit_log"
    managed_by  = "terraform"
  }
}
