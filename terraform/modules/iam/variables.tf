variable "project_id" {
  description = "The GCP project ID"
  type        = string
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
}

variable "region" {
  description = "GCP region"
  type        = string
}

variable "workload_identity_pool_id" {
  description = "The full resource name of the Workload Identity Pool"
  type        = string
}

variable "workspace_provider_id" {
  description = "ID of the Google Workspace OIDC provider"
  type        = string
}

variable "github_provider_id" {
  description = "ID of the GitHub Actions OIDC provider (null disables the binding)"
  type        = string
  default     = null
}

# --- WIF binding scoping (replaces wildcard principalSets) ---

variable "workspace_domain" {
  description = "Google Workspace hosted-domain (the WIF SA binding is restricted to attribute.hd/<this>)"
  type        = string
  default     = ""
}

variable "github_repository" {
  description = "GitHub repository in 'org/repo' form (the WIF SA binding is restricted to attribute.repository/<this>)"
  type        = string
  default     = ""
}

# --- Policy toggles ---

variable "enable_deny_policies" {
  description = "Create the IAM Deny policy blocking BigQuery writes on the data SA"
  type        = bool
  default     = true
}

variable "organization_id" {
  description = "GCP organization ID. When set, a PAB policy restricts both SAs to the home project. Requires org-level IAM admin."
  type        = string
  default     = ""
}
