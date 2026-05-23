/**
 * Multi-region Disaster Recovery — optional secondary Cloud Run region.
 *
 * When `enable_dr_region = true`, a second Cloud Run service is created
 * in `var.dr_region`. The primary region's global external ALB picks up
 * the DR region's NEG as an additional backend (see main.tf where
 * dr_neg_id is wired into module.cloud_run).
 *
 * Cloud Run Service Health (GA April 2026) drives health-based failover
 * between regions. Requires:
 *   - min_instances >= 1 on both services (already the default in this
 *     module for warm health checks)
 *   - an HTTP readiness probe on each service (set on /health in the
 *     cloud-run module)
 *   - at least two regions behind the same global ALB
 *
 * The DR networking module is separate from the primary: it provisions
 * its own VPC, subnet, NAT, and firewall in the DR region. Cloud Armor
 * and VPC-SC live ONLY on the primary (they're attached at the LB and
 * project levels respectively).
 */

module "networking_dr" {
  count  = var.enable_dr_region ? 1 : 0
  source = "./modules/networking"

  project_id  = var.project_id
  region      = var.dr_region
  environment = "${var.environment}-dr"
  vpc_cidr    = var.dr_vpc_cidr

  # Primary VPC handles Cloud Armor (LB-level) and the perimeter. DR
  # only needs VPC + subnet + NAT + firewall.
  enable_cloud_armor             = false
  enable_vpc_service_controls    = false
  enable_private_service_connect = false

  depends_on = [google_project_service.required_apis]
}

module "cloud_run_dr" {
  count  = var.enable_dr_region ? 1 : 0
  source = "./modules/cloud-run"

  project_id            = var.project_id
  region                = var.dr_region
  environment           = "${var.environment}-dr"
  service_account_email = module.iam.mcp_service_account_email
  image                 = var.mcp_server_image
  cpu                   = var.mcp_server_cpu
  memory                = var.mcp_server_memory
  min_instances         = var.mcp_server_min_instances
  max_instances         = var.mcp_server_max_instances
  request_timeout       = var.mcp_server_request_timeout
  startup_cpu_boost     = var.mcp_server_startup_cpu_boost

  network_id    = module.networking_dr[0].network_self_link
  subnetwork_id = module.networking_dr[0].subnet_id
  vpc_egress    = var.vpc_egress

  # No LB in the DR module — its NEG is wired into the PRIMARY's LB
  # backend_service via main.tf -> module.cloud_run.dr_neg_id.
  cloud_armor_policy_id = null

  bigquery_location           = var.bigquery_location
  enable_binary_authorization = var.enable_binary_authorization

  # Lock DR ingress to load balancer / internal only.
  ingress_mode = "internal-and-cloud-load-balancing"

  depends_on = [module.iam]
}
