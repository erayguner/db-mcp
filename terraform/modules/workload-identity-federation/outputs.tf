output "pool_id" {
  description = "The ID of the Workload Identity Pool"
  value       = google_iam_workload_identity_pool.main.workload_identity_pool_id
}

output "pool_name" {
  description = "The full resource name of the Workload Identity Pool"
  value       = google_iam_workload_identity_pool.main.name
}

output "workspace_provider_id" {
  description = "The ID of the Google Workspace OIDC provider"
  value       = length(google_iam_workload_identity_pool_provider.google_workspace) > 0 ? google_iam_workload_identity_pool_provider.google_workspace[0].workload_identity_pool_provider_id : null
}

output "workspace_provider_name" {
  description = "The full resource name of the Google Workspace OIDC provider"
  value       = length(google_iam_workload_identity_pool_provider.google_workspace) > 0 ? google_iam_workload_identity_pool_provider.google_workspace[0].name : null
}

output "github_provider_id" {
  description = "The ID of the GitHub Actions OIDC provider"
  value       = length(google_iam_workload_identity_pool_provider.github) > 0 ? google_iam_workload_identity_pool_provider.github[0].workload_identity_pool_provider_id : null
}

output "github_provider_name" {
  description = "The full resource name of the GitHub Actions OIDC provider"
  value       = length(google_iam_workload_identity_pool_provider.github) > 0 ? google_iam_workload_identity_pool_provider.github[0].name : null
}

output "workspace_auth_command" {
  description = "Command to authenticate using Google Workspace"
  value       = length(google_iam_workload_identity_pool_provider.google_workspace) > 0 ? "gcloud iam workload-identity-pools create-cred-config ${google_iam_workload_identity_pool_provider.google_workspace[0].name} --service-account=SERVICE_ACCOUNT_EMAIL --output-file=credentials.json --credential-source-type=oidc-file" : null
}
