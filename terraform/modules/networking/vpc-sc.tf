/**
 * VPC Service Controls perimeter.
 *
 * FIXES: the perimeter is now created only when an access policy is
 * actually supplied (previously it would fail `apply` with an empty
 * parent), and it deploys in DRY-RUN mode by default — violations are
 * logged, never blocked. Promote to enforced mode only after ~2 weeks
 * of clean dry-run audit logs.
 *
 * Find dry-run violations with:
 *   protoPayload.metadata.dryRun="true"
 *   protoPayload.@type="type.googleapis.com/google.cloud.audit.VpcServiceControlAuditMetadata"
 */

resource "google_access_context_manager_service_perimeter" "mcp_perimeter" {
  count = var.enable_vpc_service_controls && var.access_policy_name != "" ? 1 : 0

  parent = "accessPolicies/${var.access_policy_name}"
  name   = "accessPolicies/${var.access_policy_name}/servicePerimeters/mcp_bigquery_${var.environment}"
  title  = "MCP BigQuery Perimeter - ${var.environment}"

  # Dry-run: `spec` is evaluated and logged; `status` is enforced.
  use_explicit_dry_run_spec = true

  # Enforced config — intentionally empty until dry-run validation completes.
  status {
    restricted_services = []
  }

  # Dry-run config — the intended perimeter.
  spec {
    restricted_services = var.vpc_sc_restricted_services

    vpc_accessible_services {
      enable_restriction = true
      allowed_services   = var.vpc_sc_allowed_services
    }

    # Allow in-perimeter identities to call BigQuery in the listed projects.
    dynamic "egress_policies" {
      for_each = var.vpc_sc_egress_to_projects
      content {
        egress_from {
          identity_type = "ANY_IDENTITY"
        }
        egress_to {
          resources = ["projects/${egress_policies.value}"]
          operations {
            service_name = "bigquery.googleapis.com"
            method_selectors {
              method = "*"
            }
          }
        }
      }
    }

    # Allow CI/CD (and other listed projects) to manage Cloud Run.
    dynamic "ingress_policies" {
      for_each = var.vpc_sc_ingress_from_projects
      content {
        ingress_from {
          identity_type = "ANY_IDENTITY"
          sources {
            resource = "projects/${ingress_policies.value}"
          }
        }
        ingress_to {
          resources = ["*"]
          operations {
            service_name = "run.googleapis.com"
            method_selectors {
              method = "*"
            }
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [status[0].resources, spec[0].resources]
  }
}
