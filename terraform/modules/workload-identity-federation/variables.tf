variable "project_id" {
  description = "The GCP project ID"
  type        = string
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
}

variable "workspace_domain" {
  description = "Google Workspace domain for OIDC authentication (e.g., example.com)"
  type        = string
}

variable "github_org" {
  description = "GitHub organization for GitHub Actions OIDC"
  type        = string
  default     = ""
}

variable "github_repo" {
  description = "GitHub repository for GitHub Actions OIDC (format: repo-name, not org/repo)"
  type        = string
  default     = ""
}

variable "allowed_audiences" {
  description = "Allowed audiences for OIDC tokens"
  type        = list(string)
  default     = []
}

# Generic OIDC Provider Variables
variable "enable_generic_oidc" {
  description = "Enable generic OIDC provider for custom identity providers"
  type        = bool
  default     = false
}

variable "generic_oidc_issuer_uri" {
  description = "Issuer URI for generic OIDC provider"
  type        = string
  default     = ""
}

variable "generic_oidc_attribute_mapping" {
  description = "Attribute mapping for generic OIDC provider"
  type        = map(string)
  default = {
    "google.subject" = "assertion.sub"
  }
}

variable "generic_oidc_attribute_condition" {
  description = "Attribute condition for generic OIDC provider"
  type        = string
  default     = null
}

# Numeric GitHub owner ID for cybersquatting-resistant scoping.
# Find it via: gh api /users/<owner> --jq .id
# When set, the GitHub provider's attribute_condition also pins this ID.
variable "github_repository_owner_id" {
  description = "Numeric GitHub repository owner ID (immutable). Empty = name-based scoping only."
  type        = string
  default     = ""
}
