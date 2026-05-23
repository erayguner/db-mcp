/**
 * Private Service Connect (PSC) — private ingress for enterprise tenants.
 *
 * CORRECTED ARCHITECTURE: a PSC service attachment cannot target a global
 * external load balancer. It must target a REGIONAL INTERNAL load balancer
 * forwarding rule. This file builds a regional internal Application Load
 * Balancer (INTERNAL_MANAGED) over a serverless NEG and attaches PSC to it.
 *
 * Requires (from the networking module):
 *   - a REGIONAL_MANAGED_PROXY proxy-only subnet in the region
 *   - a PRIVATE_SERVICE_CONNECT NAT subnet (var.psc_nat_subnet_id)
 *
 * Disabled by default. Note: Gemini Enterprise custom MCP connectors do
 * not yet support PSC — this is for direct enterprise-tenant consumers.
 */

resource "google_compute_region_network_endpoint_group" "mcp_neg_psc" {
  count = var.enable_private_service_connect ? 1 : 0

  name                  = "mcp-bigquery-neg-psc-${var.environment}"
  network_endpoint_type = "SERVERLESS"
  region                = var.region
  project               = var.project_id

  cloud_run {
    service = google_cloud_run_v2_service.mcp_server.name
  }
}

resource "google_compute_region_backend_service" "mcp_psc" {
  count = var.enable_private_service_connect ? 1 : 0

  name                  = "mcp-bigquery-psc-backend-${var.environment}"
  project               = var.project_id
  region                = var.region
  protocol              = "HTTP"
  load_balancing_scheme = "INTERNAL_MANAGED"

  backend {
    group           = google_compute_region_network_endpoint_group.mcp_neg_psc[0].id
    balancing_mode  = "UTILIZATION"
    capacity_scaler = 1.0
  }
}

resource "google_compute_region_url_map" "mcp_psc" {
  count = var.enable_private_service_connect ? 1 : 0

  name            = "mcp-bigquery-psc-urlmap-${var.environment}"
  project         = var.project_id
  region          = var.region
  default_service = google_compute_region_backend_service.mcp_psc[0].id
}

resource "google_compute_region_target_http_proxy" "mcp_psc" {
  count = var.enable_private_service_connect ? 1 : 0

  name    = "mcp-bigquery-psc-proxy-${var.environment}"
  project = var.project_id
  region  = var.region
  url_map = google_compute_region_url_map.mcp_psc[0].id
}

resource "google_compute_forwarding_rule" "mcp_psc_ilb" {
  count = var.enable_private_service_connect ? 1 : 0

  name                  = "mcp-bigquery-psc-ilb-${var.environment}"
  project               = var.project_id
  region                = var.region
  load_balancing_scheme = "INTERNAL_MANAGED"
  target                = google_compute_region_target_http_proxy.mcp_psc[0].id
  port_range            = "80"
  network               = var.network_id
  subnetwork            = var.subnetwork_id

  # The regional internal LB requires a REGIONAL_MANAGED_PROXY subnet to
  # exist in this region/network (provisioned by the networking module).
  depends_on = [var.proxy_only_subnet_id]
}

resource "google_compute_service_attachment" "mcp_psc" {
  count = var.enable_private_service_connect ? 1 : 0

  name        = "mcp-bigquery-psc-${var.environment}"
  project     = var.project_id
  region      = var.region
  description = "PSC service attachment for the MCP BigQuery server (${var.environment})"

  enable_proxy_protocol = false
  connection_preference = length(var.psc_accepted_projects) > 0 ? "ACCEPT_MANUAL" : "ACCEPT_AUTOMATIC"
  nat_subnets           = [var.psc_nat_subnet_id]
  target_service        = google_compute_forwarding_rule.mcp_psc_ilb[0].id

  dynamic "consumer_accept_lists" {
    for_each = var.psc_accepted_projects
    content {
      project_id_or_num = consumer_accept_lists.value
      connection_limit  = 10
    }
  }
}
