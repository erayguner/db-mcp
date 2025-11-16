variable "project_id" {
  description = "The GCP project ID"
  type        = string
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
}

variable "region" {
  description = "The GCP region"
  type        = string
}

variable "workload_identity_pool_id" {
  description = "The full resource name of the Workload Identity Pool"
  type        = string
}

variable "workspace_provider_id" {
  description = "The ID of the Google Workspace OIDC provider"
  type        = string
}

variable "github_provider_id" {
  description = "The ID of the GitHub Actions OIDC provider"
  type        = string
  default     = null
}

variable "allow_public_access" {
  description = "Allow public access to Cloud Run service (allUsers invoker)"
  type        = bool
  default     = false
}
