/**
 * Global external Application Load Balancer for the MCP server.
 *
 * The Serverless NEG is created unconditionally so the primary cloud-run
 * module can reference NEGs created by sibling invocations (e.g. a DR
 * region's cloud-run module) via `var.dr_neg_id`.
 *
 * The backend service + url_map + proxy + forwarding rule are gated on
 * a Cloud Armor policy being supplied. When DR is enabled and a
 * `dr_neg_id` is passed, the backend service attaches BOTH regional NEGs;
 * Cloud Run Service Health drives health-based failover.
 */

resource "google_compute_region_network_endpoint_group" "mcp_neg" {
  name                  = "mcp-bigquery-neg-${var.environment}"
  network_endpoint_type = "SERVERLESS"
  region                = var.region
  project               = var.project_id

  cloud_run {
    service = google_cloud_run_v2_service.mcp_server.name
  }
}

resource "google_compute_backend_service" "mcp_backend" {
  count = var.cloud_armor_policy_id != null ? 1 : 0

  name                  = "mcp-bigquery-backend-${var.environment}"
  project               = var.project_id
  protocol              = "HTTP"
  port_name             = "http"
  timeout_sec           = 300
  load_balancing_scheme = "EXTERNAL_MANAGED"
  security_policy       = var.cloud_armor_policy_id

  # Primary regional NEG.
  backend {
    group = google_compute_region_network_endpoint_group.mcp_neg.id
  }

  # Optional secondary regional NEG for multi-region DR.
  dynamic "backend" {
    for_each = var.dr_neg_id != "" ? [var.dr_neg_id] : []
    content {
      group = backend.value
    }
  }

  log_config {
    enable      = true
    sample_rate = var.environment == "prod" ? 0.5 : 1.0
  }

  dynamic "iap" {
    for_each = var.iap_client_id != "" ? [1] : []
    content {
      enabled              = true
      oauth2_client_id     = var.iap_client_id
      oauth2_client_secret = var.iap_client_secret
    }
  }
}

resource "google_compute_url_map" "mcp_url_map" {
  count = var.cloud_armor_policy_id != null ? 1 : 0

  name            = "mcp-bigquery-urlmap-${var.environment}"
  project         = var.project_id
  default_service = google_compute_backend_service.mcp_backend[0].id
}

resource "google_compute_target_https_proxy" "mcp_https_proxy" {
  count = var.cloud_armor_policy_id != null && var.ssl_certificate_id != "" ? 1 : 0

  name             = "mcp-bigquery-https-proxy-${var.environment}"
  project          = var.project_id
  url_map          = google_compute_url_map.mcp_url_map[0].id
  ssl_certificates = [var.ssl_certificate_id]
}

resource "google_compute_global_forwarding_rule" "mcp_https" {
  count = var.cloud_armor_policy_id != null && var.ssl_certificate_id != "" ? 1 : 0

  name                  = "mcp-bigquery-https-${var.environment}"
  project               = var.project_id
  target                = google_compute_target_https_proxy.mcp_https_proxy[0].id
  port_range            = "443"
  ip_address            = var.static_ip_address != "" ? var.static_ip_address : null
  load_balancing_scheme = "EXTERNAL_MANAGED"
}
