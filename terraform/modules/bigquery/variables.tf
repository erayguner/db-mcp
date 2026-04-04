variable "project_id" {
  description = "The GCP project ID"
  type        = string
}

variable "region" {
  description = "The GCP region"
  type        = string
  default     = "europe-west2"
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
