output "remediation_topic_id" {
  description = "Remediation Pub/Sub topic ID"
  value       = google_pubsub_topic.remediation.id
}

output "remediation_subscription_id" {
  description = "Remediation Pub/Sub subscription ID"
  value       = google_pubsub_subscription.remediation.id
}

output "workflow_id" {
  description = "HITL approval workflow ID"
  value       = google_workflows_workflow.hitl_approval.id
}

output "worker_pool_id" {
  description = "Remediation worker pool ID"
  value       = google_cloud_run_v2_worker_pool.remediation.id
}

output "worker_service_account_email" {
  description = "Least-privilege worker service account email"
  value       = google_service_account.worker.email
}

output "slack_webhook_secret_id" {
  description = "Secret Manager secret ID for the Slack webhook URL (value managed out-of-band)"
  value       = google_secret_manager_secret.slack_webhook.secret_id
}
