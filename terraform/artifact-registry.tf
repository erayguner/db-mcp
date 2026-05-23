/**
 * Artifact Registry — container image repository for the MCP server.
 *
 * Container Registry (gcr.io) was fully shut down on 2025-03-18. This
 * Artifact Registry repository at `${region}-docker.pkg.dev` is the
 * replacement. CI/CD pushes images here; Cloud Run pulls from here.
 *
 * Conventions (shared with .github/workflows/deploy.yml):
 *   - Repo ID: db-mcp
 *   - Image name: mcp-bigquery-server
 *   - Full path: REGION-docker.pkg.dev/PROJECT/db-mcp/mcp-bigquery-server
 *
 * Cleanup policy retains the last 10 tagged releases and purges untagged
 * layers older than 7 days. Immutable tags prevent silent tag overwrites.
 */

resource "google_artifact_registry_repository" "db_mcp" {
  project       = var.project_id
  location      = var.region
  repository_id = "db-mcp"
  description   = "Container images for the MCP BigQuery server"
  format        = "DOCKER"

  cleanup_policy_dry_run = false

  docker_config {
    immutable_tags = true
  }

  cleanup_policies {
    id     = "keep-tagged-releases"
    action = "KEEP"
    most_recent_versions {
      keep_count = 10
    }
  }

  cleanup_policies {
    id     = "delete-old-untagged"
    action = "DELETE"
    condition {
      tag_state  = "UNTAGGED"
      older_than = "604800s" # 7 days
    }
  }

  labels = {
    environment = var.environment
    component   = "mcp-bigquery-server"
    managed_by  = "terraform"
  }

  depends_on = [google_project_service.required_apis]
}

# Cloud Run runtime SA: pull images.
resource "google_artifact_registry_repository_iam_member" "runtime_reader" {
  project    = var.project_id
  location   = google_artifact_registry_repository.db_mcp.location
  repository = google_artifact_registry_repository.db_mcp.name
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${module.iam.mcp_service_account_email}"
}

# CI/CD (via WIF) impersonates the MCP SA to push images. Grant the SA
# write access to this repo only (not project-wide).
resource "google_artifact_registry_repository_iam_member" "deployer_writer" {
  project    = var.project_id
  location   = google_artifact_registry_repository.db_mcp.location
  repository = google_artifact_registry_repository.db_mcp.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${module.iam.mcp_service_account_email}"
}
