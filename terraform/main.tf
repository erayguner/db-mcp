/**
 * GCP MCP Server Infrastructure with Workload Identity Federation
 *
 * This Terraform configuration deploys a secure MCP server on GCP using:
 * - Workload Identity Federation (no service account keys!)
 * - BigQuery for data storage
 * - Cloud Run for serverless deployment
 * - VPC Service Controls for security
 * - Cloud Monitoring for observability
 */

# Enable required GCP APIs
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
  ])

  project = var.project_id
  service = each.value

  disable_on_destroy = false
}

# Workload Identity Federation Module
module "workload_identity_federation" {
  source = "./modules/workload-identity-federation"

  project_id        = var.project_id
  environment       = var.environment
  workspace_domain  = var.workspace_domain
  github_org        = var.github_org
  github_repo       = var.github_repo
  allowed_audiences = var.allowed_audiences

  depends_on = [google_project_service.required_apis]
}

# IAM Module - Service Accounts and Permissions
module "iam" {
  source = "./modules/iam"

  project_id  = var.project_id
  environment = var.environment
  region      = var.region

  workload_identity_pool_id = module.workload_identity_federation.pool_id
  workspace_provider_id     = module.workload_identity_federation.workspace_provider_id
  github_provider_id        = module.workload_identity_federation.github_provider_id

  depends_on = [module.workload_identity_federation]
}

# BigQuery Module
module "bigquery" {
  source = "./modules/bigquery"

  project_id      = var.project_id
  datasets        = var.bigquery_datasets
  service_account = module.iam.mcp_service_account_email
  environment     = var.environment

  depends_on = [module.iam]
}

# Networking Module
module "networking" {
  source = "./modules/networking"

  project_id                  = var.project_id
  region                      = var.region
  environment                 = var.environment
  vpc_cidr                    = var.vpc_cidr
  enable_vpc_service_controls = var.enable_vpc_service_controls
  enable_cloud_armor          = var.enable_cloud_armor
  allowed_ip_ranges           = var.allowed_ip_ranges

  depends_on = [google_project_service.required_apis]
}

# Cloud Run Module
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
  vpc_connector_id      = module.networking.vpc_connector_id
  cloud_armor_policy_id = module.networking.cloud_armor_policy_id

  depends_on = [module.iam, module.networking]
}

# Monitoring Module
module "monitoring" {
  source = "./modules/monitoring"

  project_id         = var.project_id
  environment        = var.environment
  cloud_run_location = var.region
  cloud_run_url      = module.cloud_run.service_url

  # Notification channels (destructure from object)
  alert_email           = var.notification_channels.alert_email
  slack_webhook_url     = var.notification_channels.slack_webhook_url
  pagerduty_service_key = var.notification_channels.pagerduty_service_key

  depends_on = [module.cloud_run]
}
