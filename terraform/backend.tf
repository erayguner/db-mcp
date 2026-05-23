# Remote state backend.
#
# The bucket itself is bootstrapped by state-bucket.tf (see the comments
# there for the one-time migration workflow). Initialise per environment:
#
#   terraform init -backend-config=environments/<env>/backend.conf -reconfigure
#
# Each environment's backend.conf supplies:
#   bucket = "<state-bucket-name>"
#   prefix = "mcp-server/<env>"
#
# GCS provides automatic state locking and encryption at rest; the
# bucket itself enables versioning and lifecycle pruning.

terraform {
  backend "gcs" {
    # Configured via -backend-config=environments/<env>/backend.conf
  }
}
