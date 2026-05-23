variable "project_id" {
  description = "The GCP project ID"
  type        = string
}

variable "region" {
  description = "The GCP region (used for resources that must be regional, e.g. policy tag taxonomy)"
  type        = string
  default     = "europe-west2"
}

variable "bigquery_location" {
  description = "BigQuery dataset location. Multi-region 'EU' / 'US' or a specific region. KMS keyring location is derived from this."
  type        = string
  default     = "EU"
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
}

variable "service_account" {
  description = "Service account email for BigQuery access"
  type        = string
}

variable "datasets" {
  description = "Map of BigQuery datasets to create"
  type = map(object({
    location                    = string
    description                 = string
    delete_contents_on_destroy  = bool
    default_table_expiration_ms = number
    labels                      = map(string)
  }))
}

variable "enable_audit_logging" {
  description = "Enable audit logging for BigQuery datasets"
  type        = bool
  default     = true
}

# Tenant-scoped IAM bindings with IAM Conditions.
# Each entry creates a conditional IAM member binding on the specified datasets,
# providing defense-in-depth behind the application-layer YAML allowlist.
# Principals are typically Workload Identity principalSet URIs keyed by tenant.
variable "tenant_dataset_bindings" {
  description = "Per-tenant BigQuery dataset IAM bindings with IAM Conditions"
  type = map(object({
    principal         = string
    role              = string
    datasets          = list(string)
    condition_title   = optional(string, "tenant-dataset-scope")
    condition_expires = optional(string, "")
  }))
  default = {}
}

# --- Tenant isolation scaffolding (governance.tf) ---

variable "enable_policy_tags" {
  description = "Create the PII policy-tag taxonomy for column-level security"
  type        = bool
  default     = false
}

variable "authorized_views" {
  description = "Authorized views to expose curated columns to tenants. See governance.tf for the shape."
  type = map(object({
    source_dataset = string
    source_table   = string
    view_dataset   = string
    query          = string
  }))
  default = {}
}
