terraform {
  required_version = ">= 1.14.0"

  required_providers {
    # Pinned floor: hashicorp/google 7.34.0 (released 2026-05-27). google and
    # google-beta MUST stay in lockstep (same major.minor) — mismatched
    # versions produce confusing plan diffs and schema errors.
    #
    # UPGRADE CAVEAT: upgrading from <7.31 to >=7.31 introduces the universal
    # `deletion_policy` argument on many MMv1 resources (pubsub, model_armor,
    # workflows, cloud_run_v2_worker_pool, etc.). The first `plan` after the
    # bump shows a one-time, no-op-on-apply diff adding `deletion_policy =
    # "DELETE"` (the default). This is expected and safe; review and apply once.
    google = {
      source  = "hashicorp/google"
      version = "~> 7.34"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 7.34"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}
