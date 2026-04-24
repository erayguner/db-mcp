output "notification_channel_email_id" {
  description = "Email notification channel ID"
  value       = google_monitoring_notification_channel.email.id
}

output "notification_channel_slack_id" {
  description = "Slack notification channel ID"
  value       = var.slack_webhook_url != "" ? google_monitoring_notification_channel.slack[0].id : null
  sensitive   = true
}

output "notification_channel_pagerduty_id" {
  description = "PagerDuty notification channel ID"
  value       = var.pagerduty_service_key != "" ? google_monitoring_notification_channel.pagerduty[0].id : null
  sensitive   = true
}

output "alert_policy_ids" {
  description = "Map of alert policy IDs"
  value = {
    high_error_rate    = google_monitoring_alert_policy.high_error_rate.id
    high_latency       = google_monitoring_alert_policy.high_latency.id
    auth_failures      = google_monitoring_alert_policy.auth_failures.id
    instance_count     = google_monitoring_alert_policy.instance_count.id
    memory_utilization = google_monitoring_alert_policy.memory_utilization.id
    uptime_check       = var.cloud_run_url != "" ? google_monitoring_alert_policy.uptime_check[0].id : null
  }
}

output "log_metric_names" {
  description = "Map of log-based metric names"
  value = {
    error_count    = google_logging_metric.error_count.name
    query_latency  = google_logging_metric.query_latency.name
    auth_failures  = google_logging_metric.auth_failures.name
    bigquery_bytes = google_logging_metric.bigquery_bytes_processed.name
  }
}

output "slo_ids" {
  description = "Map of SLO IDs"
  value = {
    availability = google_monitoring_slo.availability.id
    latency      = google_monitoring_slo.latency.id
  }
}

output "dashboard_id" {
  description = "Monitoring dashboard ID"
  value       = google_monitoring_dashboard.mcp_bigquery.id
}

output "dashboard_url" {
  description = "Monitoring dashboard URL"
  value       = "https://console.cloud.google.com/monitoring/dashboards/custom/${google_monitoring_dashboard.mcp_bigquery.id}?project=${var.project_id}"
}

output "uptime_check_id" {
  description = "Uptime check ID"
  value       = var.cloud_run_url != "" ? google_monitoring_uptime_check_config.health_check[0].uptime_check_id : null
}

output "custom_service_id" {
  description = "Custom service ID for SLO tracking"
  value       = google_monitoring_custom_service.mcp_bigquery.service_id
}
