# Project Configuration
variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP Region"
  type        = string
  default     = "europe-west2"
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging, or prod."
  }
}

# Workload Identity Federation
variable "workspace_domain" {
  description = "Google Workspace domain for OIDC authentication"
  type        = string
  default     = ""
}

variable "github_org" {
  description = "GitHub organization name"
  type        = string
  default     = ""
}

variable "github_repo" {
  description = "GitHub repository name (without org)"
  type        = string
  default     = ""
}

variable "allowed_audiences" {
  description = "Allowed audiences for OIDC tokens"
  type        = list(string)
  default     = []
}

# BigQuery Configuration
variable "bigquery_datasets" {
  description = "BigQuery datasets to create"
  type = map(object({
    location                    = string
    description                 = string
    delete_contents_on_destroy  = bool
    default_table_expiration_ms = number
    labels                      = map(string)
  }))
  default = {}
}

# Tenant IAM Conditions (defense-in-depth for YAML allowlist)
variable "tenant_dataset_bindings" {
  description = "Per-tenant BigQuery dataset IAM bindings, enforced via IAM Conditions"
  type = map(object({
    principal         = string
    role              = string
    datasets          = list(string)
    condition_title   = optional(string, "tenant-dataset-scope")
    condition_expires = optional(string, "")
  }))
  default = {}
}

# Networking
variable "vpc_cidr" {
  description = "CIDR block for VPC"
  type        = string
  default     = "10.0.0.0/24"
}

variable "enable_cloud_armor" {
  description = "Enable Cloud Armor WAF and DDoS protection"
  type        = bool
  default     = true
}

# Private Service Connect (PSC) — optional private ingress alternative
# to public Cloud Run. Enterprise consumers attach to the PSC service
# attachment instead of traversing the public internet.
variable "enable_private_service_connect" {
  description = "Expose the MCP server via a PSC service attachment (requires Cloud Armor + SSL cert)"
  type        = bool
  default     = false
}

variable "psc_nat_subnet_cidr" {
  description = "CIDR for the PSC NAT subnet (disjoint from vpc_cidr)"
  type        = string
  default     = "10.0.1.0/24"
}

variable "psc_accepted_projects" {
  description = "Consumer GCP project IDs allowed to connect via PSC (empty = accept all)"
  type        = list(string)
  default     = []
}

variable "access_policy_name" {
  description = "Access Context Manager policy name for VPC Service Controls"
  type        = string
  default     = ""
}

# Cloud Run
variable "mcp_server_image" {
  description = "Container image for MCP BigQuery server"
  type        = string
}

variable "mcp_server_cpu" {
  description = "CPU allocation for Cloud Run"
  type        = string
  default     = "1"
}

variable "mcp_server_memory" {
  description = "Memory allocation for Cloud Run"
  type        = string
  default     = "512Mi"
}

variable "mcp_server_min_instances" {
  description = "Minimum number of Cloud Run instances"
  type        = number
  default     = 0
}

variable "mcp_server_max_instances" {
  description = "Maximum number of Cloud Run instances"
  type        = number
  default     = 10
}

variable "allow_unauthenticated" {
  description = "Allow unauthenticated access to Cloud Run service"
  type        = bool
  default     = false
}

variable "custom_domain" {
  description = "Custom domain for Cloud Run service"
  type        = string
  default     = ""
}

variable "enable_binary_authorization" {
  description = "Enable Binary Authorization for container images"
  type        = bool
  default     = false
}

variable "bigquery_location" {
  description = "BigQuery location for datasets"
  type        = string
  default     = "EU"
}

variable "iap_client_id" {
  description = "Identity-Aware Proxy OAuth2 client ID"
  type        = string
  default     = ""
}

variable "iap_client_secret" {
  description = "Identity-Aware Proxy OAuth2 client secret"
  type        = string
  default     = ""
  sensitive   = true
}

variable "ssl_certificate_id" {
  description = "SSL certificate ID for HTTPS load balancer"
  type        = string
  default     = ""
}

variable "static_ip_address" {
  description = "Static IP address for load balancer"
  type        = string
  default     = ""
}

# Security
variable "enable_vpc_service_controls" {
  description = "Enable VPC Service Controls"
  type        = bool
  default     = true
}

variable "enable_audit_logging" {
  description = "Enable comprehensive audit logging"
  type        = bool
  default     = true
}

variable "allowed_ip_ranges" {
  description = "Allowed IP ranges for Cloud Run ingress"
  type        = list(string)
  default     = []
}

# Monitoring
variable "notification_channels" {
  description = "Notification channels configuration"
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

variable "enable_uptime_checks" {
  description = "Enable uptime checks for Cloud Run service"
  type        = bool
  default     = true
}

# Tags
variable "labels" {
  description = "Common labels to apply to all resources"
  type        = map(string)
  default     = {}
}

variable "mcp_transport" {
  description = "MCP transport type (stdio or http)"
  type        = string
  default     = "http"
}
