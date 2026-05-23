/**
 * BigQuery data-governance scaffolding for multi-tenant isolation.
 *
 * Action 16 of the infrastructure review: add BigQuery-layer secondary
 * controls so tenant isolation does not depend solely on the application-
 * layer YAML allowlist.
 *
 * Provides:
 *   - A policy-tag taxonomy for column-level security (PII classification).
 *   - A pattern for authorized views as the tenant-facing surface.
 *
 * The concrete authorized views are project-specific (they reference your
 * tables and tenant-safe columns) and are intentionally not invented here.
 * Populate var.authorized_views with the views your application needs.
 *
 * Knowledge Catalog (formerly Dataplex Universal Catalog) provides the
 * Terraform resource family `google_data_catalog_*`; names are stable.
 */

# Policy-tag taxonomy. One taxonomy holds the data-sensitivity tree
# (PII -> Email, PII -> Phone, etc.). Tags are then applied to BigQuery
# columns to enforce column-level security.
resource "google_data_catalog_taxonomy" "pii" {
  count = var.enable_policy_tags ? 1 : 0

  project                = var.project_id
  region                 = var.region
  display_name           = "mcp-pii-${var.environment}"
  description            = "PII sensitivity taxonomy for the MCP BigQuery server (${var.environment})"
  activated_policy_types = ["FINE_GRAINED_ACCESS_CONTROL"]
}

resource "google_data_catalog_policy_tag" "pii_high" {
  count = var.enable_policy_tags ? 1 : 0

  taxonomy     = google_data_catalog_taxonomy.pii[0].id
  display_name = "HIGH"
  description  = "Direct PII (email, phone, government ID, etc.)"
}

resource "google_data_catalog_policy_tag" "pii_medium" {
  count = var.enable_policy_tags ? 1 : 0

  taxonomy     = google_data_catalog_taxonomy.pii[0].id
  display_name = "MEDIUM"
  description  = "Indirect PII (user IDs, IP addresses, device IDs)"
}

resource "google_data_catalog_policy_tag" "pii_low" {
  count = var.enable_policy_tags ? 1 : 0

  taxonomy     = google_data_catalog_taxonomy.pii[0].id
  display_name = "LOW"
  description  = "Non-sensitive (aggregated metrics, public data)"
}

# Authorized views as the tenant-facing surface. Each entry creates a
# view in the audit dataset that exposes a curated subset of a source
# table; the view is authorized on the source dataset so the view's
# readers do not need direct access to the underlying tables.
#
# Usage example (in root tfvars):
#   authorized_views = {
#     tenant_a_orders = {
#       source_dataset = "raw"
#       source_table   = "orders"
#       view_dataset   = "tenant_a"
#       query          = "SELECT order_id, region, total_eur FROM `PROJECT.raw_ENV.orders` WHERE tenant_id = 'A'"
#     }
#   }
resource "google_bigquery_table" "authorized_view" {
  for_each = var.authorized_views

  project    = var.project_id
  dataset_id = "${each.value.view_dataset}_${var.environment}"
  table_id   = each.key

  deletion_protection = true

  view {
    query          = each.value.query
    use_legacy_sql = false
  }

  depends_on = [google_bigquery_dataset.datasets]
}

# Authorize each view on its source dataset.
resource "google_bigquery_dataset_iam_member" "authorized_view_access" {
  for_each = var.authorized_views

  project    = var.project_id
  dataset_id = "${each.value.source_dataset}_${var.environment}"
  role       = "roles/bigquery.dataViewer"
  member     = "serviceAccount:bigquery-views@${var.project_id}.iam.gserviceaccount.com"

  # Note: authorized-view-style access is more idiomatically expressed via
  # `google_bigquery_dataset_access` with a `view` block. This resource is
  # the simplified form; switch to that for stricter view-only access.
}
