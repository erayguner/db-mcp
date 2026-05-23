# ---------------------------------------------------------------------------
# Project & Region
# ---------------------------------------------------------------------------

variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP region for compute resources"
  type        = string
  default     = "europe-west2"
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be dev, staging, or prod."
  }
}

variable "organization_id" {
  description = "GCP organization ID. Required for PAB policy. Empty disables PAB."
  type        = string
  default     = ""
}

# ---------------------------------------------------------------------------
# Workload Identity Federation
# ---------------------------------------------------------------------------

variable "workspace_domain" {
  description = "Google Workspace hosted-domain for OIDC (scopes WIF binding to attribute.hd/<this>)"
  type        = string
  default     = ""
}

variable "github_org" {
  description = "GitHub organization for Actions OIDC"
  type        = string
  default     = ""
}

variable "github_repo" {
  description = "GitHub repository name (without org) for Actions OIDC"
  type        = string
  default     = ""
}

variable "github_repository_owner_id" {
  description = "Numeric GitHub repository owner ID (immutable). Find with: gh api /users/<owner> --jq .id"
  type        = string
  default     = ""
}

variable "allowed_audiences" {
  description = "Allowed audiences for OIDC tokens"
  type        = list(string)
  default     = []
}

# ---------------------------------------------------------------------------
# IAM
# ---------------------------------------------------------------------------

variable "enable_deny_policies" {
  description = "Create the IAM Deny policy blocking BigQuery writes on the data SA"
  type        = bool
  default     = true
}

# ---------------------------------------------------------------------------
# BigQuery
# ---------------------------------------------------------------------------

variable "bigquery_location" {
  description = "BigQuery dataset location ('EU' multi-region, 'US', or a specific region). KMS keyring location is derived."
  type        = string
  default     = "EU"
}

variable "bigquery_datasets" {
  description = "Datasets to create"
  type = map(object({
    location                    = string
    description                 = string
    delete_contents_on_destroy  = bool
    default_table_expiration_ms = number
    labels                      = map(string)
  }))
  default = {}
}

variable "tenant_dataset_bindings" {
  description = "Per-tenant BigQuery dataset IAM bindings enforced via IAM Conditions"
  type = map(object({
    principal         = string
    role              = string
    datasets          = list(string)
    condition_title   = optional(string, "tenant-dataset-scope")
    condition_expires = optional(string, "")
  }))
  default = {}
}

variable "enable_policy_tags" {
  description = "Create the PII policy-tag taxonomy for column-level security"
  type        = bool
  default     = false
}

variable "authorized_views" {
  description = "Authorized views exposing curated columns to tenants. See modules/bigquery/governance.tf."
  type = map(object({
    source_dataset = string
    source_table   = string
    view_dataset   = string
    query          = string
  }))
  default = {}
}

# ---------------------------------------------------------------------------
# Networking
# ---------------------------------------------------------------------------

variable "vpc_cidr" {
  description = "CIDR for the primary subnet (Direct VPC egress; /26 or larger)"
  type        = string
  default     = "10.0.0.0/24"
}

variable "psc_nat_subnet_cidr" {
  description = "CIDR for the PSC NAT subnet (disjoint from vpc_cidr)"
  type        = string
  default     = "10.0.1.0/24"
}

variable "proxy_only_subnet_cidr" {
  description = "CIDR for the REGIONAL_MANAGED_PROXY subnet (PSC internal LB)"
  type        = string
  default     = "10.0.2.0/24"
}

variable "enable_private_service_connect" {
  description = "Expose the service via a PSC service attachment"
  type        = bool
  default     = false
}

variable "psc_accepted_projects" {
  description = "Consumer project IDs allowed to connect via PSC"
  type        = list(string)
  default     = []
}

variable "vpc_egress" {
  description = "Direct VPC egress scope: PRIVATE_RANGES_ONLY or ALL_TRAFFIC"
  type        = string
  default     = "PRIVATE_RANGES_ONLY"
}

variable "enable_cloud_armor" {
  description = "Create the Cloud Armor policy"
  type        = bool
  default     = true
}

variable "restrict_to_allowlist" {
  description = "Cloud Armor default-deny mode (only allowed_ip_ranges may reach the service)"
  type        = bool
  default     = false
}

variable "allowed_ip_ranges" {
  description = "IP ranges allowed when restrict_to_allowlist = true"
  type        = list(string)
  default     = []
}

variable "waf_ruleset_version" {
  description = "OWASP CRS rule version suffix (v33 = CRS 3.3 GA; v422 = CRS 4.22)"
  type        = string
  default     = "v33"
}

variable "waf_sensitivity" {
  description = "Cloud Armor preconfigured WAF sensitivity 1-4"
  type        = number
  default     = 1
}

variable "enable_vpc_service_controls" {
  description = "Create a VPC-SC perimeter in dry-run mode"
  type        = bool
  default     = false
}

variable "access_policy_name" {
  description = "Access Context Manager policy ID. Required for the VPC-SC perimeter."
  type        = string
  default     = ""
}

variable "vpc_sc_egress_to_projects" {
  description = "Project IDs in-perimeter identities may call BigQuery in"
  type        = list(string)
  default     = []
}

variable "vpc_sc_ingress_from_projects" {
  description = "Project IDs allowed to manage Cloud Run from outside the perimeter (e.g. CI/CD)"
  type        = list(string)
  default     = []
}

# ---------------------------------------------------------------------------
# Cloud Run
# ---------------------------------------------------------------------------

variable "mcp_server_image" {
  description = "Container image (Artifact Registry path, pinned to a digest)"
  type        = string
}

variable "mcp_server_cpu" {
  description = "CPU allocation"
  type        = string
  default     = "1"
}

variable "mcp_server_memory" {
  description = "Memory allocation (gen2 minimum 512Mi)"
  type        = string
  default     = "512Mi"
}

variable "mcp_server_min_instances" {
  description = "Minimum instances (>=1 in prod for warm starts and multi-region health)"
  type        = number
  default     = 1
}

variable "mcp_server_max_instances" {
  description = "Maximum instances"
  type        = number
  default     = 10
}

variable "mcp_server_request_timeout" {
  description = "Cloud Run request timeout (max 3600s for long-lived MCP sessions)"
  type        = string
  default     = "3600s"
}

variable "mcp_server_startup_cpu_boost" {
  description = "Enable startup CPU boost for faster cold starts"
  type        = bool
  default     = true
}

variable "enable_binary_authorization" {
  description = "Enforce Binary Authorization on Cloud Run"
  type        = bool
  default     = false
}

variable "iap_client_id" {
  description = "IAP OAuth2 client ID (enables IAP on the ALB when set)"
  type        = string
  default     = ""
}

variable "iap_client_secret" {
  description = "IAP OAuth2 client secret"
  type        = string
  default     = ""
  sensitive   = true
}

variable "ssl_certificate_id" {
  description = "SSL certificate ID for the HTTPS LB"
  type        = string
  default     = ""
}

variable "static_ip_address" {
  description = "Static global IP for the LB"
  type        = string
  default     = ""
}

# ---------------------------------------------------------------------------
# Multi-region Disaster Recovery
# ---------------------------------------------------------------------------

variable "enable_dr_region" {
  description = "Provision a secondary Cloud Run region attached as an additional ALB backend"
  type        = bool
  default     = false
}

variable "dr_region" {
  description = "Secondary GCP region for the DR Cloud Run service"
  type        = string
  default     = "europe-west4"
}

variable "dr_vpc_cidr" {
  description = "CIDR for the DR region's VPC subnet"
  type        = string
  default     = "10.1.0.0/24"
}

# ---------------------------------------------------------------------------
# Monitoring
# ---------------------------------------------------------------------------

variable "notification_channels" {
  description = "Notification channel configuration"
  type = object({
    alert_email           = string
    slack_webhook_url     = optional(string, "")
    pagerduty_service_key = optional(string, "")
  })
  default = {
    alert_email           = ""
    slack_webhook_url     = ""
    pagerduty_service_key = ""
  }
}

# ---------------------------------------------------------------------------
# Labels
# ---------------------------------------------------------------------------

variable "labels" {
  description = "Common labels applied to all resources"
  type        = map(string)
  default     = {}
}
