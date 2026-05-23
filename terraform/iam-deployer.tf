/**
 * Deployer roles for the MCP service account.
 *
 * The same service account is used both as the Cloud Run runtime identity
 * (via the iam module) AND as the CI/CD deployer (impersonated via WIF
 * from GitHub Actions). The deployer roles are granted here, at the root,
 * to keep the iam module focused on runtime bindings.
 *
 * RECOMMENDED FUTURE IMPROVEMENT: split the deployer into a separate SA
 * (Cloud Run docs recommend deployer != runtime). For now they share
 * an identity to minimise blast-radius change.
 */

locals {
  deployer_project_roles = [
    "roles/run.developer",          # Deploy Cloud Run services
    "roles/clouddeploy.releaser",   # Create Cloud Deploy releases (if Cloud Deploy is adopted)
    "roles/iam.serviceAccountUser", # Act-as the runtime SA when deploying
  ]
}

resource "google_project_iam_member" "deployer" {
  for_each = toset(local.deployer_project_roles)

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${module.iam.mcp_service_account_email}"
}
