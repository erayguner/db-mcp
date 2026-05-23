/**
 * IAM Deny Policy — defense-in-depth backstop.
 *
 * Even if a future role grant accidentally adds BigQuery write permissions
 * back onto the data-tier service account, this deny policy blocks them.
 * Deny policies always override allow policies.
 *
 * Scoped to the BigQuery service account principal only — does not affect
 * other identities in the project.
 */

resource "google_iam_deny_policy" "bq_sa_no_writes" {
  count = var.enable_deny_policies ? 1 : 0

  parent       = urlencode("cloudresourcemanager.googleapis.com/projects/${var.project_id}")
  name         = "mcp-bq-no-writes-${var.environment}"
  display_name = "Deny BigQuery writes on the MCP BigQuery SA (${var.environment})"

  rules {
    description = "Block all BigQuery write/delete operations on this SA"
    deny_rule {
      denied_principals = [
        "principal://iam.googleapis.com/projects/-/serviceAccounts/${google_service_account.bigquery.email}",
      ]
      denied_permissions = [
        "bigquery.googleapis.com/tables.create",
        "bigquery.googleapis.com/tables.delete",
        "bigquery.googleapis.com/tables.update",
        "bigquery.googleapis.com/tables.updateData",
        "bigquery.googleapis.com/datasets.create",
        "bigquery.googleapis.com/datasets.delete",
        "bigquery.googleapis.com/datasets.update",
        "bigquery.googleapis.com/routines.create",
        "bigquery.googleapis.com/routines.delete",
        "bigquery.googleapis.com/routines.update",
      ]
    }
  }
}
