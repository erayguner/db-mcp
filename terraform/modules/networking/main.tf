/**
 * Networking Module — VPC, subnets, Cloud NAT, firewall
 *
 * The Serverless VPC Access connector has been REMOVED. Cloud Run now
 * uses Direct VPC egress (GA) — it attaches directly to the subnet,
 * eliminating the always-on e2-micro connector instances (~$15-25/mo)
 * and roughly doubling egress throughput.
 *
 * Cloud Armor lives in armor.tf; VPC Service Controls in vpc-sc.tf.
 */

# VPC Network (custom-mode)
resource "google_compute_network" "mcp_vpc" {
  name                    = "mcp-bigquery-vpc-${var.environment}"
  auto_create_subnetworks = false
  project                 = var.project_id
  description             = "VPC for MCP BigQuery Server - ${var.environment}"
}

# Primary subnet — Cloud Run attaches here via Direct VPC egress.
# Must be /26 or larger; /24 gives ample headroom for IP allocation.
resource "google_compute_subnetwork" "mcp_subnet" {
  name          = "mcp-bigquery-subnet-${var.environment}"
  ip_cidr_range = var.vpc_cidr
  region        = var.region
  network       = google_compute_network.mcp_vpc.id
  project       = var.project_id

  private_ip_google_access = true

  log_config {
    aggregation_interval = "INTERVAL_5_SEC"
    flow_sampling        = 0.5
    metadata             = "INCLUDE_ALL_METADATA"
  }
}

# Proxy-only subnet — required by the regional internal Application Load
# Balancer that fronts the PSC service attachment (see cloud-run/psc.tf).
resource "google_compute_subnetwork" "proxy_only" {
  count = var.enable_private_service_connect ? 1 : 0

  name          = "mcp-bigquery-proxy-only-${var.environment}"
  ip_cidr_range = var.proxy_only_subnet_cidr
  region        = var.region
  network       = google_compute_network.mcp_vpc.id
  project       = var.project_id
  purpose       = "REGIONAL_MANAGED_PROXY"
  role          = "ACTIVE"
}

# PSC NAT subnet — used by the PSC service attachment.
resource "google_compute_subnetwork" "psc_nat" {
  count = var.enable_private_service_connect ? 1 : 0

  name          = "mcp-bigquery-psc-nat-${var.environment}"
  project       = var.project_id
  region        = var.region
  network       = google_compute_network.mcp_vpc.id
  ip_cidr_range = var.psc_nat_subnet_cidr
  purpose       = "PRIVATE_SERVICE_CONNECT"
}

# Firewall — deny ingress by default (defense in depth).
resource "google_compute_firewall" "deny_all_ingress" {
  name      = "mcp-deny-all-ingress-${var.environment}"
  network   = google_compute_network.mcp_vpc.name
  project   = var.project_id
  priority  = 65534
  direction = "INGRESS"

  deny {
    protocol = "all"
  }

  source_ranges = ["0.0.0.0/0"]
  description   = "Deny all ingress by default"
}

# Allow Google Cloud health-check probe ranges.
resource "google_compute_firewall" "allow_health_checks" {
  name      = "mcp-allow-health-checks-${var.environment}"
  network   = google_compute_network.mcp_vpc.name
  project   = var.project_id
  direction = "INGRESS"

  allow {
    protocol = "tcp"
    ports    = ["8080"]
  }

  source_ranges = ["130.211.0.0/22", "35.191.0.0/16"]
  target_tags   = ["mcp-server-${var.environment}"]
  description   = "Allow Google Cloud load balancer health checks"
}

# Cloud Router + NAT — outbound connectivity for ALL_TRAFFIC egress mode
# and any private workloads. With PRIVATE_RANGES_ONLY egress, public
# traffic bypasses NAT and goes direct.
resource "google_compute_router" "mcp_router" {
  name    = "mcp-bigquery-router-${var.environment}"
  region  = var.region
  network = google_compute_network.mcp_vpc.id
  project = var.project_id
}

resource "google_compute_router_nat" "mcp_nat" {
  name                               = "mcp-bigquery-nat-${var.environment}"
  router                             = google_compute_router.mcp_router.name
  region                             = var.region
  project                            = var.project_id
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"

  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }
}
