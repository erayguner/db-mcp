/**
 * BigQuery cost-control quotas.
 *
 * Per-SA daily query byte cap as a hard backstop in addition to the
 * MCP "cost elicitation" dry-run gate.
 *
 * NOTE: as of provider hashicorp/google v7.x there is no first-class
 * Terraform resource for BigQuery custom quotas
 * (`google_service_usage_consumer_quota_override` is not available).
 * Apply the override via gcloud (or via Service Usage REST API in a
 * null_resource provisioner) after `terraform apply`:
 *
 *   gcloud alpha services quota update \
 *     --service=bigquery.googleapis.com \
 *     --consumer=projects/PROJECT_ID \
 *     --metric=bigquery.googleapis.com/quota/query/usage \
 *     --unit=1/d/{project}/{user} \
 *     --value=1099511627776   # 1 TiB in bytes
 *
 * Variables are kept here as a record of intent and can be threaded
 * through to a future provisioner.
 */

variable "enable_bq_query_quota" {
  description = "Apply a per-user-per-day BigQuery query-bytes quota (manual gcloud step — see file header)"
  type        = bool
  default     = false
}

variable "bq_query_tib_per_user_per_day" {
  description = "BigQuery query bytes per user per day, in TiB"
  type        = number
  default     = 1
}

# Surface the configured values as outputs so the manual gcloud command
# can be templated from `terraform output`.
output "bq_quota_intent" {
  description = "Intended BigQuery query-bytes quota (apply via gcloud per file header)"
  value = {
    enabled                = var.enable_bq_query_quota
    bytes_per_user_per_day = var.bq_query_tib_per_user_per_day * 1099511627776
    gcloud_command         = "gcloud alpha services quota update --service=bigquery.googleapis.com --consumer=projects/${var.project_id} --metric=bigquery.googleapis.com/quota/query/usage --unit=1/d/{project}/{user} --value=${var.bq_query_tib_per_user_per_day * 1099511627776}"
  }
}
