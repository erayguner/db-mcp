/**
 * Networking Module - VPC, Cloud Armor, VPC Service Controls
 *
 * Provides network security for the MCP BigQuery server:
 * - VPC with private service networking
 * - Cloud Armor for DDoS protection and WAF
 * - VPC Service Controls for data perimeter
 * - Serverless VPC Access for Cloud Run
 */

# VPC Network
resource "google_compute_network" "mcp_vpc" {
  name                    = "mcp-bigquery-vpc-${var.environment}"
  auto_create_subnetworks = false
  project                 = var.project_id

  description = "VPC for MCP BigQuery Server - ${var.environment}"
}

# Subnet for Cloud Run VPC connector
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

# Serverless VPC Access Connector
resource "google_vpc_access_connector" "mcp_connector" {
  name          = "mcp-bigquery-connector-${var.environment}"
  region        = var.region
  project       = var.project_id
  network       = google_compute_network.mcp_vpc.name
  ip_cidr_range = cidrsubnet(var.vpc_cidr, 4, 1) # /28 subnet from VPC CIDR

  min_instances = 2
  max_instances = 10

  machine_type = "e2-micro" # Cost-effective for MCP traffic
}

# Cloud Armor Security Policy
resource "google_compute_security_policy" "mcp_armor" {
  count   = var.enable_cloud_armor ? 1 : 0
  name    = "mcp-bigquery-armor-${var.environment}"
  project = var.project_id

  description = "Cloud Armor policy for MCP BigQuery server - DDoS and WAF protection"

  # Default rule - deny all
  rule {
    action   = "deny(403)"
    priority = 2147483647
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    description = "Default deny rule"
  }

  # Allow whitelisted IP ranges
  dynamic "rule" {
    for_each = var.allowed_ip_ranges
    content {
      action   = "allow"
      priority = 1000 + rule.key
      match {
        versioned_expr = "SRC_IPS_V1"
        config {
          src_ip_ranges = [rule.value]
        }
      }
      description = "Allow whitelisted IP: ${rule.value}"
    }
  }

  # Rate limiting rule - 100 requests per minute per IP
  rule {
    action   = "rate_based_ban"
    priority = 100
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"

      rate_limit_threshold {
        count        = var.environment == "production" ? 100 : 1000
        interval_sec = 60
      }

      ban_duration_sec = 600 # 10 minute ban
    }
    description = "Rate limiting - ${var.environment == "production" ? 100 : 1000} requests per minute"
  }

  # Block common SQL injection patterns
  rule {
    action   = "deny(403)"
    priority = 200
    match {
      expr {
        expression = <<-EOT
          request.path.contains('union') && request.path.contains('select') ||
          request.path.contains('drop') && request.path.contains('table') ||
          request.path.contains('--') ||
          request.path.contains('/*') ||
          request.path.contains('xp_')
        EOT
      }
    }
    description = "Block SQL injection patterns in URL"
  }

  # Block common XSS patterns
  rule {
    action   = "deny(403)"
    priority = 300
    match {
      expr {
        expression = <<-EOT
          request.path.contains('<script') ||
          request.path.contains('javascript:') ||
          request.path.contains('onerror=') ||
          request.path.contains('onclick=')
        EOT
      }
    }
    description = "Block XSS patterns in URL"
  }

  # Preconfigured WAF rules
  rule {
    action   = "deny(403)"
    priority = 400
    match {
      expr {
        expression = "evaluatePreconfiguredExpr('sqli-stable')"
      }
    }
    description = "Google preconfigured SQL injection protection"
  }

  rule {
    action   = "deny(403)"
    priority = 500
    match {
      expr {
        expression = "evaluatePreconfiguredExpr('xss-stable')"
      }
    }
    description = "Google preconfigured XSS protection"
  }

  rule {
    action   = "deny(403)"
    priority = 600
    match {
      expr {
        expression = "evaluatePreconfiguredExpr('lfi-stable')"
      }
    }
    description = "Google preconfigured local file inclusion protection"
  }

  rule {
    action   = "deny(403)"
    priority = 700
    match {
      expr {
        expression = "evaluatePreconfiguredExpr('rce-stable')"
      }
    }
    description = "Google preconfigured remote code execution protection"
  }

  # Adaptive protection - ML-based DDoS mitigation
  adaptive_protection_config {
    layer_7_ddos_defense_config {
      enable = true
    }
  }
}

# Firewall Rules
resource "google_compute_firewall" "allow_health_checks" {
  name    = "mcp-allow-health-checks-${var.environment}"
  network = google_compute_network.mcp_vpc.name
  project = var.project_id

  allow {
    protocol = "tcp"
    ports    = ["8080"]
  }

  source_ranges = [
    "130.211.0.0/22", # Google Cloud health check ranges
    "35.191.0.0/16",
  ]

  target_tags = ["mcp-server"]

  description = "Allow health checks from Google Cloud Load Balancers"
}

resource "google_compute_firewall" "deny_all_ingress" {
  name     = "mcp-deny-all-ingress-${var.environment}"
  network  = google_compute_network.mcp_vpc.name
  project  = var.project_id
  priority = 65534 # Lower priority than allow rules

  deny {
    protocol = "all"
  }

  source_ranges = ["0.0.0.0/0"]

  description = "Deny all ingress traffic by default"
}

# VPC Service Controls (if enabled)
resource "google_access_context_manager_service_perimeter" "mcp_perimeter" {
  count  = var.enable_vpc_service_controls ? 1 : 0
  parent = "accessPolicies/${var.access_policy_name}"
  name   = "accessPolicies/${var.access_policy_name}/servicePerimeters/mcp_bigquery_${var.environment}"

  title = "MCP BigQuery Service Perimeter - ${var.environment}"

  status {
    restricted_services = [
      "bigquery.googleapis.com",
      "storage.googleapis.com",
    ]

    vpc_accessible_services {
      enable_restriction = true
      allowed_services = [
        "bigquery.googleapis.com",
        "storage.googleapis.com",
        "monitoring.googleapis.com",
        "logging.googleapis.com",
      ]
    }

    access_levels = []
  }

  lifecycle {
    ignore_changes = [status[0].resources]
  }
}

# Private Service Connect — NAT subnet used by the PSC service attachment.
# The matching service attachment is created in the cloud-run module so it can
# reference the load balancer's forwarding rule.
resource "google_compute_subnetwork" "psc_nat" {
  count = var.enable_private_service_connect ? 1 : 0

  name          = "mcp-bigquery-psc-nat-${var.environment}"
  project       = var.project_id
  region        = var.region
  network       = google_compute_network.mcp_vpc.id
  ip_cidr_range = var.psc_nat_subnet_cidr
  purpose       = "PRIVATE_SERVICE_CONNECT"
}

# Cloud NAT for outbound connectivity (if needed)
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
