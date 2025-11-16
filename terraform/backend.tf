# Remote state backend configuration
# Initialize with: terraform init -backend-config="bucket=YOUR_BUCKET_NAME"

terraform {
  backend "gcs" {
    # bucket  = "terraform-state-PROJECT_ID"  # Set via backend-config
    # prefix  = "mcp-server"                  # Set via backend-config

    # State locking is automatic with GCS
    # Encryption at rest is automatic
    # Versioning should be enabled on the bucket
  }
}

# Optional: Create the state bucket with this commented-out resource
# Uncomment and apply separately before migrating state

# resource "google_storage_bucket" "terraform_state" {
#   name          = "terraform-state-${var.project_id}"
#   location      = var.region
#   force_destroy = false
#
#   uniform_bucket_level_access = true
#
#   versioning {
#     enabled = true
#   }
#
#   lifecycle_rule {
#     condition {
#       num_newer_versions = 10
#     }
#     action {
#       type = "Delete"
#     }
#   }
#
#   encryption {
#     default_kms_key_name = google_kms_crypto_key.terraform_state.id
#   }
#
#   labels = merge(var.labels, {
#     purpose = "terraform-state"
#   })
# }
