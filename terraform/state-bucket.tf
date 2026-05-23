/**
 * Terraform state bucket — BOOTSTRAP.
 *
 * The state backend (backend.tf) is configured to a GCS bucket. That
 * bucket must exist BEFORE `terraform init` can succeed. Apply this
 * file once, manually, with local state, then migrate state into it:
 *
 *   # 1. Apply with local state (one-time bootstrap)
 *   terraform init   # no -backend-config; local backend
 *   terraform apply -target=google_storage_bucket.terraform_state \
 *                   -var-file=environments/<env>/terraform.tfvars
 *
 *   # 2. Edit backend.tf to enable the GCS backend, then migrate
 *   terraform init -backend-config=environments/<env>/backend.conf -migrate-state
 *
 * The bucket is multi-region (EU or US dual-region equivalent) so the
 * state survives a regional outage in the primary compute region.
 *
 * Set var.create_state_bucket = true on the first apply, then back to
 * false (or leave true — the bucket has prevent_destroy).
 */

variable "create_state_bucket" {
  description = "Bootstrap the Terraform state bucket (one-time; leave false after migration)"
  type        = bool
  default     = false
}

variable "state_bucket_name" {
  description = "GCS bucket name for Terraform state (must be globally unique)"
  type        = string
  default     = ""
}

variable "state_bucket_location" {
  description = "Multi-region location for the state bucket (EU, US, ASIA, or a dual-region like EUR4/NAM4)"
  type        = string
  default     = "EU"
}

resource "google_storage_bucket" "terraform_state" {
  count = var.create_state_bucket && var.state_bucket_name != "" ? 1 : 0

  project       = var.project_id
  name          = var.state_bucket_name
  location      = var.state_bucket_location
  force_destroy = false

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  versioning {
    enabled = true
  }

  # Keep the last 10 versions of each state object.
  lifecycle_rule {
    condition {
      num_newer_versions = 10
    }
    action {
      type = "Delete"
    }
  }

  # Belt-and-braces: also drop noncurrent versions after 90 days.
  lifecycle_rule {
    condition {
      days_since_noncurrent_time = 90
      with_state                 = "ARCHIVED"
    }
    action {
      type = "Delete"
    }
  }

  labels = merge(var.labels, {
    purpose     = "terraform-state"
    environment = var.environment
    managed_by  = "terraform"
  })

  lifecycle {
    prevent_destroy = true
  }
}
