/**
 * GCP MCP BigQuery Server — Root Module
 *
 * Single source of truth for the MCP BigQuery server infrastructure.
 * Composes seven modules and several root-level files:
 *
 *   modules/
 *     workload-identity-federation  — keyless auth pools/providers
 *     iam                           — runtime + data SAs, Deny + PAB policies
 *     bigquery                      — datasets (CMEK), audit logs, governance
 *     networking                    — VPC, Direct VPC egress, Cloud Armor, VPC-SC, PSC
 *     cloud-run                     — google_cloud_run_v2_service + LB + PSC LB
 *     monitoring                    — alert policies, SLOs, dashboards
 *
 *   artifact-registry.tf  — image repository (replaces gcr.io)
 *   binary-authorization.tf — KMS cosign key + attestor + policy
 *   audit-logging.tf      — 7-year Cloud Logging bucket + Data Access audit config
 *   bigquery-quotas.tf    — per-SA query byte quota override
 *   iam-deployer.tf       — deployer-role grants on the MCP SA
 *   dr.tf                 — optional secondary-region Cloud Run
 *   state-bucket.tf       — bootstrap multi-region Terraform state bucket
 */

# Enable required GCP APIs.
resource "google_project_service" "required_apis" {
  for_each = toset([
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "bigquery.googleapis.com",
    "run.googleapis.com",
    "compute.googleapis.com",
    "monitoring.googleapis.com",
    "logging.googleapis.com",
    "secretmanager.googleapis.com",
    "artifactregistry.googleapis.com",
    "containerscanning.googleapis.com",
    "binaryauthorization.googleapis.com",
    "containeranalysis.googleapis.com",
    "cloudkms.googleapis.com",
    "clouddeploy.googleapis.com",
    "datacatalog.googleapis.com",
    "accesscontextmanager.googleapis.com",
    "modelarmor.googleapis.com",
    # Automation / HITL (R17/R18). Harmless when enable_automation = false;
    # enabling an API does not create billable resources.
    "pubsub.googleapis.com",
    "workflows.googleapis.com",
    "workflowexecutions.googleapis.com",
    "aiplatform.googleapis.com",
  ])

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

# --- Workload Identity Federation ---
module "workload_identity_federation" {
  source = "./modules/workload-identity-federation"

  project_id                 = var.project_id
  environment                = var.environment
  workspace_domain           = var.workspace_domain
  github_org                 = var.github_org
  github_repo                = var.github_repo
  github_repository_owner_id = var.github_repository_owner_id
  allowed_audiences          = var.allowed_audiences

  depends_on = [google_project_service.required_apis]
}

# --- IAM ---
module "iam" {
  source = "./modules/iam"

  project_id  = var.project_id
  environment = var.environment
  region      = var.region

  workload_identity_pool_id = module.workload_identity_federation.pool_name
  workspace_provider_id     = module.workload_identity_federation.workspace_provider_id
  github_provider_id        = module.workload_identity_federation.github_provider_id

  workspace_domain  = var.workspace_domain
  github_repository = var.github_org != "" && var.github_repo != "" ? "${var.github_org}/${var.github_repo}" : ""

  enable_deny_policies = var.enable_deny_policies
  organization_id      = var.organization_id

  depends_on = [module.workload_identity_federation]
}

# --- BigQuery ---
module "bigquery" {
  source = "./modules/bigquery"

  project_id              = var.project_id
  region                  = var.region
  bigquery_location       = var.bigquery_location
  datasets                = var.bigquery_datasets
  service_account         = module.iam.bigquery_service_account_email
  environment             = var.environment
  tenant_dataset_bindings = var.tenant_dataset_bindings
  enable_policy_tags      = var.enable_policy_tags
  authorized_views        = var.authorized_views

  # Read-only by default. Set true only for datasets that must accept writes.
  grant_data_editor = var.grant_data_editor

  depends_on = [module.iam]
}

# --- Networking ---
module "networking" {
  source = "./modules/networking"

  project_id                     = var.project_id
  region                         = var.region
  environment                    = var.environment
  vpc_cidr                       = var.vpc_cidr
  psc_nat_subnet_cidr            = var.psc_nat_subnet_cidr
  proxy_only_subnet_cidr         = var.proxy_only_subnet_cidr
  enable_private_service_connect = var.enable_private_service_connect

  enable_cloud_armor    = var.enable_cloud_armor
  restrict_to_allowlist = var.restrict_to_allowlist
  allowed_ip_ranges     = var.allowed_ip_ranges
  waf_ruleset_version   = var.waf_ruleset_version
  waf_sensitivity       = var.waf_sensitivity

  enable_vpc_service_controls  = var.enable_vpc_service_controls
  access_policy_name           = var.access_policy_name
  enforce_perimeter            = var.enforce_perimeter
  vpc_sc_egress_to_projects    = var.vpc_sc_egress_to_projects
  vpc_sc_ingress_from_projects = var.vpc_sc_ingress_from_projects

  # Scope the IAM-role-based egress example to the MCP runtime SA (BigQuery +
  # Vertex AI). Empty disables that example rule.
  vpc_sc_runtime_service_account = module.iam.mcp_service_account_email

  depends_on = [google_project_service.required_apis, module.iam]
}

# --- Model Armor (feature-flagged; default off) ---
# Screens LLM prompts/responses before BigQuery. The template lives in
# google-beta; the app calls it at runtime via the MODEL_ARMOR_* env vars wired
# into the Cloud Run module below.
module "model_armor" {
  source = "./modules/model-armor"
  count  = var.enable_model_armor ? 1 : 0

  providers = {
    google-beta = google-beta
  }

  project_id  = var.project_id
  location    = var.model_armor_location
  environment = var.environment

  enforcement_type     = var.model_armor_enforcement_type
  enable_floor_setting = var.model_armor_enable_floor_setting

  depends_on = [google_project_service.required_apis]
}

# --- Cloud Run (primary region) ---
module "cloud_run" {
  source = "./modules/cloud-run"

  project_id            = var.project_id
  region                = var.region
  environment           = var.environment
  service_account_email = module.iam.mcp_service_account_email
  image                 = var.mcp_server_image
  cpu                   = var.mcp_server_cpu
  memory                = var.mcp_server_memory
  min_instances         = var.mcp_server_min_instances
  max_instances         = var.mcp_server_max_instances
  request_timeout       = var.mcp_server_request_timeout
  startup_cpu_boost     = var.mcp_server_startup_cpu_boost

  # Direct VPC egress (replaces the Serverless VPC connector).
  network_id    = module.networking.network_self_link
  subnetwork_id = module.networking.subnet_id
  vpc_egress    = var.vpc_egress

  cloud_armor_policy_id       = module.networking.cloud_armor_policy_id
  bigquery_location           = var.bigquery_location
  enable_binary_authorization = var.enable_binary_authorization
  iap_client_id               = var.iap_client_id
  iap_client_secret           = var.iap_client_secret
  ssl_certificate_id          = var.ssl_certificate_id
  static_ip_address           = var.static_ip_address

  # Lock ingress to the load-balancer path when PSC is enabled.
  ingress_mode = var.enable_private_service_connect ? "internal-and-cloud-load-balancing" : "all"

  # PSC (corrected: regional internal LB target).
  enable_private_service_connect = var.enable_private_service_connect
  psc_nat_subnet_id              = module.networking.psc_nat_subnet_id
  proxy_only_subnet_id           = module.networking.proxy_only_subnet_id
  psc_accepted_projects          = var.psc_accepted_projects

  # Multi-region DR: attach the DR region's NEG when enabled (see dr.tf).
  dr_neg_id = try(module.cloud_run_dr[0].neg_id, "")

  # Feature-flagged Model Armor wiring. When enable_model_armor=false this is an
  # empty map, leaving the container env unchanged. MODEL_ARMOR_FILTER_VERSION
  # is passed for forward-compat: the template has no filter-version field
  # (set at runtime by the service), so the app selects "v3"/Latest via env.
  extra_env_vars = var.enable_model_armor ? {
    MODEL_ARMOR_ENABLED        = "true"
    MODEL_ARMOR_TEMPLATE       = module.model_armor[0].template_resource
    MODEL_ARMOR_LOCATION       = var.model_armor_location
    MODEL_ARMOR_FILTER_VERSION = var.model_armor_filter_version
  } : {}

  depends_on = [module.iam, module.networking]
}

# --- Monitoring ---
module "monitoring" {
  source = "./modules/monitoring"

  project_id         = var.project_id
  environment        = var.environment
  cloud_run_location = var.region
  cloud_run_url      = module.cloud_run.service_url

  alert_email           = var.notification_channels.alert_email
  slack_webhook_url     = var.notification_channels.slack_webhook_url
  pagerduty_service_key = var.notification_channels.pagerduty_service_key

  enable_alerts = var.enable_alerts

  depends_on = [module.cloud_run]
}

# --- Automation / HITL (R17/R18; feature-flagged, default off) ---
# Event-driven remediation pipeline with human-in-the-loop approval. Nothing is
# created unless enable_automation = true.
module "automation" {
  source = "./modules/automation"
  count  = var.enable_automation ? 1 : 0

  project_id  = var.project_id
  region      = var.region
  environment = var.environment

  worker_image            = var.automation_worker_image
  worker_instance_count   = var.automation_worker_instance_count
  enable_ai_inference_smt = var.automation_enable_ai_inference_smt
  ai_inference_endpoint   = var.automation_ai_inference_endpoint

  depends_on = [google_project_service.required_apis]
}
