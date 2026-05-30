# --- Workload Identity Federation ---
output "workload_identity_pool_id" {
  description = "Workload Identity Pool ID"
  value       = module.workload_identity_federation.pool_id
}

output "workload_identity_pool_name" {
  description = "Workload Identity Pool resource name"
  value       = module.workload_identity_federation.pool_name
}

output "workspace_provider_id" {
  description = "Google Workspace OIDC provider ID"
  value       = module.workload_identity_federation.workspace_provider_id
}

output "github_provider_id" {
  description = "GitHub Actions OIDC provider ID"
  value       = module.workload_identity_federation.github_provider_id
}

output "workspace_provider_name" {
  description = "Google Workspace OIDC provider name"
  value       = module.workload_identity_federation.workspace_provider_name
}

# --- Service Accounts ---
output "mcp_service_account_email" {
  description = "Runtime / deployer SA email"
  value       = module.iam.mcp_service_account_email
}

output "bigquery_service_account_email" {
  description = "Data-tier SA email"
  value       = module.iam.bigquery_service_account_email
}

# --- BigQuery ---
output "bigquery_dataset_ids" {
  description = "Map of BigQuery dataset IDs"
  value       = module.bigquery.dataset_ids
}

output "bigquery_kms_key_id" {
  description = "KMS key used for BigQuery CMEK"
  value       = module.bigquery.kms_key_id
}

# --- Cloud Run ---
output "cloud_run_service_url" {
  description = "Primary Cloud Run service URL"
  value       = module.cloud_run.service_url
}

output "cloud_run_service_name" {
  description = "Primary Cloud Run service name"
  value       = module.cloud_run.service_name
}

output "cloud_run_dr_service_url" {
  description = "DR Cloud Run service URL (null when DR disabled)"
  value       = try(module.cloud_run_dr[0].service_url, null)
}

output "tenant_config_secret_id" {
  description = "Secret Manager secret ID for tenant configuration"
  value       = module.cloud_run.tenant_config_secret_id
}

# --- Artifact Registry ---
output "artifact_registry_repository" {
  description = "Artifact Registry repository path"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.db_mcp.repository_id}"
}

# --- Networking ---
output "vpc_id" {
  description = "Primary VPC network ID"
  value       = module.networking.vpc_id
}

output "cloud_armor_policy_id" {
  description = "Cloud Armor policy ID"
  value       = module.networking.cloud_armor_policy_id
}

output "global_lb_ip_address" {
  description = "Global external ALB IP address (null when LB disabled)"
  value       = module.cloud_run.global_ip_address
}

# --- Binary Authorization ---
output "cosign_kms_key" {
  description = "KMS key URI for cosign signing (use with: cosign sign --key gcpkms://...)"
  value       = "gcpkms://${google_kms_crypto_key.cosign.id}"
}

# --- Audit ---
output "audit_log_bucket" {
  description = "Cloud Logging bucket retaining audit logs for 7 years"
  value       = google_logging_project_bucket_config.audit_7yr.id
}

# --- Monitoring ---
output "monitoring_dashboard_url" {
  description = "Cloud Monitoring dashboard URL"
  value       = module.monitoring.dashboard_url
}

# --- Model Armor ---
output "model_armor_template" {
  description = "Model Armor template resource name (null when disabled). Set as MODEL_ARMOR_TEMPLATE."
  value       = var.enable_model_armor ? module.model_armor[0].template_resource : null
}

# --- Automation / HITL ---
output "automation_remediation_topic_id" {
  description = "Remediation Pub/Sub topic ID (null when automation disabled)."
  value       = var.enable_automation ? module.automation[0].remediation_topic_id : null
}

output "automation_workflow_id" {
  description = "HITL approval workflow ID (null when automation disabled)."
  value       = var.enable_automation ? module.automation[0].workflow_id : null
}
