/**
 * Principal Access Boundary (PAB) Policy — organization-level.
 *
 * Caps the resources both service accounts are EVER eligible to access,
 * regardless of role grants. Even if a misconfigured grant gave one of
 * these SAs access to a dataset in another project, PAB blocks it.
 *
 * REQUIRES organization-level IAM admin. Gated on var.organization_id;
 * leave it empty if you do not have org-level access.
 *
 * NOTE on bindings: as of provider hashicorp/google v7.x the
 * `google_iam_principal_access_boundary_policy` resource (the policy)
 * is supported, but the binding resource shape is provider-version
 * sensitive. The policy is created here; bind it to the two SA
 * principal sets via gcloud after `terraform apply`:
 *
 *   gcloud iam policies create-binding mcp-bind-mcp-sa-ENV \
 *     --policy=organizations/ORG_ID/locations/global/principalAccessBoundaryPolicies/mcp-home-project-ENV \
 *     --policy-kind=principalAccessBoundaryPolicies \
 *     --principal-set='principalSet://iam.googleapis.com/projects/PROJECT_ID/serviceAccounts/SA_EMAIL'
 */

resource "google_iam_principal_access_boundary_policy" "home_project_only" {
  count = var.organization_id != "" ? 1 : 0

  organization                        = var.organization_id
  location                            = "global"
  principal_access_boundary_policy_id = "mcp-home-project-${var.environment}"
  display_name                        = "MCP: restrict SAs to home project (${var.environment})"

  details {
    enforcement_version = "latest"
    rules {
      description = "Allow access only to resources in the home project"
      resources = [
        "//cloudresourcemanager.googleapis.com/projects/${var.project_id}",
      ]
      effect = "ALLOW"
    }
  }
}

# Bindings are documented in the file header (apply via gcloud). The
# policy above already exists and is ready to bind once gcloud creates
# the bindings against the MCP server SA and the BigQuery SA.

output "pab_binding_commands" {
  description = "gcloud commands to bind the PAB policy to the two SAs (run after apply)"
  value = var.organization_id == "" ? null : {
    mcp_sa = "gcloud iam policies create-binding mcp-bind-mcp-sa-${var.environment} --policy=${google_iam_principal_access_boundary_policy.home_project_only[0].name} --policy-kind=principalAccessBoundaryPolicies --principal-set='principalSet://iam.googleapis.com/projects/${var.project_id}/serviceAccounts/${google_service_account.mcp_server.email}'"
    bq_sa  = "gcloud iam policies create-binding mcp-bind-bq-sa-${var.environment} --policy=${google_iam_principal_access_boundary_policy.home_project_only[0].name} --policy-kind=principalAccessBoundaryPolicies --principal-set='principalSet://iam.googleapis.com/projects/${var.project_id}/serviceAccounts/${google_service_account.bigquery.email}'"
  }
}
