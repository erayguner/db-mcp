variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP region"
  type        = string
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR range for the primary subnet (Direct VPC egress; /26 or larger)"
  type        = string
  default     = "10.0.0.0/24"
}

variable "psc_nat_subnet_cidr" {
  description = "CIDR for the PSC NAT subnet (disjoint from vpc_cidr)"
  type        = string
  default     = "10.0.1.0/24"
}

variable "proxy_only_subnet_cidr" {
  description = "CIDR for the REGIONAL_MANAGED_PROXY subnet (PSC internal LB; disjoint from other subnets)"
  type        = string
  default     = "10.0.2.0/24"
}

variable "enable_private_service_connect" {
  description = "Provision PSC NAT + proxy-only subnets for private ingress"
  type        = bool
  default     = false
}

# --- Cloud Armor ---
variable "enable_cloud_armor" {
  description = "Create the Cloud Armor security policy"
  type        = bool
  default     = true
}

variable "restrict_to_allowlist" {
  description = "Default-deny and only allow allowed_ip_ranges (keep false for a public service)"
  type        = bool
  default     = false
}

variable "allowed_ip_ranges" {
  description = "IP ranges allowed when restrict_to_allowlist = true"
  type        = list(string)
  default     = []
}

variable "waf_ruleset_version" {
  description = "OWASP CRS rule version suffix (v33 = CRS 3.3 GA; v422 = CRS 4.22 once GA)"
  type        = string
  default     = "v33"
}

variable "waf_sensitivity" {
  description = "Cloud Armor preconfigured WAF sensitivity (1 = high-confidence only, up to 4)"
  type        = number
  default     = 1
  validation {
    condition     = var.waf_sensitivity >= 1 && var.waf_sensitivity <= 4
    error_message = "waf_sensitivity must be between 1 and 4."
  }
}

# --- VPC Service Controls ---
variable "enable_vpc_service_controls" {
  description = "Create a VPC Service Controls perimeter (requires access_policy_name)"
  type        = bool
  default     = false
}

variable "access_policy_name" {
  description = "Access Context Manager policy ID. Required for the VPC-SC perimeter."
  type        = string
  default     = ""
}

variable "enforce_perimeter" {
  description = <<-EOT
    Promote the VPC-SC perimeter from dry-run to ENFORCED. Default false keeps
    the perimeter in dry-run (spec populated, status empty) so violations are
    only logged. Set true ONLY after ~2 weeks of clean dry-run audit logs; when
    true the `status` block is populated with the same restricted_services and
    rules as `spec`, so violations are BLOCKED.
  EOT
  type        = bool
  default     = false
}

variable "vpc_sc_runtime_service_account" {
  description = <<-EOT
    MCP runtime service account email used to scope the example IAM-role-based
    egress rule (BigQuery + Vertex AI). Empty disables the example egress rule.
    Reflects the 2026-04-30 GA of IAM roles in VPC-SC ingress/egress policies.
  EOT
  type        = string
  default     = ""
}

variable "vpc_sc_restricted_services" {
  description = "Services protected by the VPC-SC perimeter"
  type        = list(string)
  default     = ["bigquery.googleapis.com", "storage.googleapis.com"]
}

variable "vpc_sc_allowed_services" {
  description = "Services reachable from within the perimeter"
  type        = list(string)
  default = [
    "bigquery.googleapis.com",
    "storage.googleapis.com",
    "monitoring.googleapis.com",
    "logging.googleapis.com",
  ]
}

variable "vpc_sc_egress_to_projects" {
  description = "Project IDs in-perimeter identities may call BigQuery in (egress rule)"
  type        = list(string)
  default     = []
}

variable "vpc_sc_ingress_from_projects" {
  description = "Project IDs allowed to manage Cloud Run from outside the perimeter (e.g. CI/CD)"
  type        = list(string)
  default     = []
}
