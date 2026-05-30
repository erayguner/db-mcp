/**
 * VPC Service Controls perimeter.
 *
 * The perimeter is created only when an access policy is actually supplied
 * (an empty parent fails `apply`), and it deploys in DRY-RUN mode by default —
 * violations are logged, never blocked. Promote to enforced mode (set
 * var.enforce_perimeter = true) only after ~2 weeks of clean dry-run audit
 * logs.
 *
 * DRY-RUN (default, enforce_perimeter = false):
 *   - use_explicit_dry_run_spec = true
 *   - spec   = the intended perimeter (evaluated + logged, NOT blocked)
 *   - status = empty (nothing enforced)
 *
 * ENFORCED (enforce_perimeter = true):
 *   - use_explicit_dry_run_spec = false
 *   - status = the intended perimeter (BLOCKED)
 *   - spec   = omitted (status is authoritative)
 *
 * Find dry-run violations with:
 *   protoPayload.metadata.dryRun="true"
 *   protoPayload.@type="type.googleapis.com/google.cloud.audit.VpcServiceControlAuditMetadata"
 */

locals {
  # Single source of truth for the perimeter so dry-run `spec` and enforced
  # `status` stay identical — only which block they live in changes.
  vpc_sc_egress_projects  = var.vpc_sc_egress_to_projects
  vpc_sc_ingress_projects = var.vpc_sc_ingress_from_projects

  # IAM-role-based egress example (GA 2026-04-30): scope the MCP runtime SA's
  # egress to BigQuery + Vertex AI in the listed projects. Only rendered when a
  # runtime SA email is supplied. `identities` (vs identity_type=ANY_IDENTITY)
  # narrows the rule to a single principal; `sources`/roles can be layered on.
  vpc_sc_iam_egress_enabled = var.vpc_sc_runtime_service_account != "" && length(var.vpc_sc_egress_to_projects) > 0
}

resource "google_access_context_manager_service_perimeter" "mcp_perimeter" {
  count = var.enable_vpc_service_controls && var.access_policy_name != "" ? 1 : 0

  parent = "accessPolicies/${var.access_policy_name}"
  name   = "accessPolicies/${var.access_policy_name}/servicePerimeters/mcp_bigquery_${var.environment}"
  title  = "MCP BigQuery Perimeter - ${var.environment}"

  # true => `spec` is dry-run (logged only) and `status` is empty.
  # false => `status` is authoritative (enforced) and `spec` is ignored.
  use_explicit_dry_run_spec = !var.enforce_perimeter

  # ----- ENFORCED config (only populated when enforce_perimeter = true) -----
  dynamic "status" {
    for_each = var.enforce_perimeter ? [1] : []
    content {
      restricted_services = var.vpc_sc_restricted_services

      vpc_accessible_services {
        enable_restriction = true
        allowed_services   = var.vpc_sc_allowed_services
      }

      # Allow in-perimeter identities to call BigQuery in the listed projects.
      dynamic "egress_policies" {
        for_each = local.vpc_sc_egress_projects
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

      # IAM-role-based egress (GA 2026-04-30) scoped to the MCP runtime SA for
      # BigQuery + Vertex AI. Lets the runtime call Vertex AI (e.g. Model Armor,
      # embeddings) and BigQuery in the listed projects without opening the
      # perimeter to ANY_IDENTITY for those services.
      dynamic "egress_policies" {
        for_each = local.vpc_sc_iam_egress_enabled ? local.vpc_sc_egress_projects : []
        content {
          egress_from {
            identities = ["serviceAccount:${var.vpc_sc_runtime_service_account}"]
          }
          egress_to {
            resources = ["projects/${egress_policies.value}"]
            operations {
              service_name = "bigquery.googleapis.com"
              method_selectors {
                method = "*"
              }
            }
            operations {
              service_name = "aiplatform.googleapis.com"
              method_selectors {
                method = "*"
              }
            }
          }
        }
      }

      # Allow CI/CD (and other listed projects) to manage Cloud Run.
      dynamic "ingress_policies" {
        for_each = local.vpc_sc_ingress_projects
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
  }

  # When enforcing, keep an empty status block out: the dynamic block above
  # provides it. When NOT enforcing, status must still exist but be empty.
  dynamic "status" {
    for_each = var.enforce_perimeter ? [] : [1]
    content {
      restricted_services = []
    }
  }

  # ----- DRY-RUN config (only populated when enforce_perimeter = false) -----
  dynamic "spec" {
    for_each = var.enforce_perimeter ? [] : [1]
    content {
      restricted_services = var.vpc_sc_restricted_services

      vpc_accessible_services {
        enable_restriction = true
        allowed_services   = var.vpc_sc_allowed_services
      }

      # Allow in-perimeter identities to call BigQuery in the listed projects.
      dynamic "egress_policies" {
        for_each = local.vpc_sc_egress_projects
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

      # IAM-role-based egress (GA 2026-04-30) scoped to the MCP runtime SA for
      # BigQuery + Vertex AI (dry-run mirror of the enforced rule above).
      dynamic "egress_policies" {
        for_each = local.vpc_sc_iam_egress_enabled ? local.vpc_sc_egress_projects : []
        content {
          egress_from {
            identities = ["serviceAccount:${var.vpc_sc_runtime_service_account}"]
          }
          egress_to {
            resources = ["projects/${egress_policies.value}"]
            operations {
              service_name = "bigquery.googleapis.com"
              method_selectors {
                method = "*"
              }
            }
            operations {
              service_name = "aiplatform.googleapis.com"
              method_selectors {
                method = "*"
              }
            }
          }
        }
      }

      # Allow CI/CD (and other listed projects) to manage Cloud Run.
      dynamic "ingress_policies" {
        for_each = local.vpc_sc_ingress_projects
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
  }

  lifecycle {
    ignore_changes = [status[0].resources, spec[0].resources]
  }
}
