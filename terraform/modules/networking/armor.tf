/**
 * Cloud Armor security policy.
 *
 * Modernized from the legacy OWASP CRS 3.0 rules (`sqli-stable`, etc.)
 * to the CRS 3.3 GA rule set via evaluatePreconfiguredWaf() with tunable
 * sensitivity. The hand-rolled `request.path.contains('select'|'drop'...)`
 * rules have been REMOVED — they caused false positives on legitimate API
 * paths and were trivially bypassed via POST body or URL encoding.
 *
 * NOTE: CRS 4.22 (`sqli-v422-stable`, …) entered Preview in 2026; swap
 * `var.waf_ruleset_version` to "v422" once it reaches GA in your projects.
 */

locals {
  waf_rules = {
    sqli = { priority = 1000, name = "sqli-${var.waf_ruleset_version}-stable" }
    xss  = { priority = 1001, name = "xss-${var.waf_ruleset_version}-stable" }
    lfi  = { priority = 1002, name = "lfi-${var.waf_ruleset_version}-stable" }
    rce  = { priority = 1003, name = "rce-${var.waf_ruleset_version}-stable" }
  }
}

resource "google_compute_security_policy" "mcp_armor" {
  count   = var.enable_cloud_armor ? 1 : 0
  name    = "mcp-bigquery-armor-${var.environment}"
  project = var.project_id

  description = "Cloud Armor policy for the MCP BigQuery server — WAF, rate limiting, DDoS"

  # Enable JSON body parsing so WAF rules inspect POST payloads (the
  # primary attack surface for a JSON-RPC API), not just the URL.
  advanced_options_config {
    json_parsing = "STANDARD"
    log_level    = "NORMAL"
  }

  # Default rule. allow = public service (required for Gemini Enterprise
  # reachability); set restrict_to_allowlist = true for an IP-gated service.
  rule {
    action      = var.restrict_to_allowlist ? "deny(403)" : "allow"
    priority    = 2147483647
    description = "Default rule"
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
  }

  # Explicit IP allowlist (only meaningful when restrict_to_allowlist = true).
  dynamic "rule" {
    for_each = var.restrict_to_allowlist ? var.allowed_ip_ranges : []
    content {
      action      = "allow"
      priority    = 900 + rule.key
      description = "Allowlisted range: ${rule.value}"
      match {
        versioned_expr = "SRC_IPS_V1"
        config {
          src_ip_ranges = [rule.value]
        }
      }
    }
  }

  # Per-IP rate limiting.
  rule {
    action      = "rate_based_ban"
    priority    = 100
    description = "Rate limiting per source IP"
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
        count        = var.environment == "prod" ? 100 : 1000
        interval_sec = 60
      }
      ban_duration_sec = 600
    }
  }

  # Preconfigured WAF rules (CRS 3.3) with tunable sensitivity.
  dynamic "rule" {
    for_each = local.waf_rules
    content {
      action      = "deny(403)"
      priority    = rule.value.priority
      description = "OWASP CRS WAF: ${rule.value.name}"
      match {
        expr {
          expression = "evaluatePreconfiguredWaf('${rule.value.name}', {'sensitivity': ${var.waf_sensitivity}})"
        }
      }
    }
  }

  # ML-based layer-7 DDoS mitigation.
  adaptive_protection_config {
    layer_7_ddos_defense_config {
      enable = true
    }
  }
}
