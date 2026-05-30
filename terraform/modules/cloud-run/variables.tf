variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP region for the Cloud Run service"
  type        = string
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
}

variable "service_account_email" {
  description = "Runtime service account email for the Cloud Run service"
  type        = string
}

variable "image" {
  description = "Container image (Artifact Registry path, ideally pinned to a digest)"
  type        = string
}

variable "cpu" {
  description = "CPU allocation"
  type        = string
  default     = "1"
}

variable "memory" {
  description = "Memory allocation (gen2 minimum 512Mi)"
  type        = string
  default     = "512Mi"
}

variable "min_instances" {
  description = "Minimum instances. Use >=1 in prod for warm starts and multi-region health checks."
  type        = number
  default     = 1
}

variable "max_instances" {
  description = "Maximum instances"
  type        = number
  default     = 10
}

variable "request_timeout" {
  description = "Request timeout (Cloud Run max 3600s). Long value supports long-lived MCP Streamable HTTP sessions."
  type        = string
  default     = "3600s"
}

variable "startup_cpu_boost" {
  description = "Allocate boosted CPU during container startup to reduce cold-start latency"
  type        = bool
  default     = true
}

# --- Networking: Direct VPC egress (replaces the Serverless VPC connector) ---
variable "network_id" {
  description = "VPC network self-link/ID for Direct VPC egress"
  type        = string
}

variable "subnetwork_id" {
  description = "Subnetwork self-link/ID for Direct VPC egress (must be /26 or larger)"
  type        = string
}

variable "vpc_egress" {
  description = "Direct VPC egress scope"
  type        = string
  default     = "PRIVATE_RANGES_ONLY"
  validation {
    condition     = contains(["PRIVATE_RANGES_ONLY", "ALL_TRAFFIC"], var.vpc_egress)
    error_message = "vpc_egress must be PRIVATE_RANGES_ONLY or ALL_TRAFFIC."
  }
}

variable "cloud_armor_policy_id" {
  description = "Cloud Armor security policy ID. When set, the global external ALB is created."
  type        = string
  default     = null
}

variable "allow_unauthenticated" {
  description = "Grant allUsers the run.invoker role (keep false; auth is enforced in-app / by IAP)"
  type        = bool
  default     = false
}

variable "custom_domain" {
  description = "Optional custom domain mapping"
  type        = string
  default     = ""
}

variable "enable_binary_authorization" {
  description = "Enforce Binary Authorization on the service"
  type        = bool
  default     = false
}

variable "bigquery_location" {
  description = "BigQuery location for the security-logs dataset and the BIGQUERY_LOCATION env var"
  type        = string
  default     = "EU"
}

variable "ingress_mode" {
  description = "Cloud Run ingress: all, internal, or internal-and-cloud-load-balancing"
  type        = string
  default     = "all"
  validation {
    condition     = contains(["all", "internal", "internal-and-cloud-load-balancing"], var.ingress_mode)
    error_message = "ingress_mode must be all, internal, or internal-and-cloud-load-balancing."
  }
}

variable "tenant_config_initial_content" {
  description = "Initial payload for the tenant-config secret (Terraform ignores later changes)"
  type        = string
  default     = "tenants: {}\n"
  sensitive   = true
}

variable "extra_env_vars" {
  description = <<-EOT
    Additional plain (non-secret) environment variables merged into the
    container env. Optional and defaulted to {} so existing callers are
    unaffected. Used to wire feature-flagged config (e.g. Model Armor) without
    changing the module's required inputs. Keys here override the module's
    built-in defaults on collision.
  EOT
  type        = map(string)
  default     = {}
}

# --- IAP (applied to the global external ALB backend) ---
variable "iap_client_id" {
  description = "IAP OAuth2 client ID (enables IAP on the ALB backend when set)"
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
  description = "SSL certificate ID for the HTTPS load balancer"
  type        = string
  default     = ""
}

variable "static_ip_address" {
  description = "Static global IP address for the load balancer"
  type        = string
  default     = ""
}

# --- Private Service Connect (corrected: targets a regional internal LB) ---
variable "enable_private_service_connect" {
  description = "Expose the service via a PSC service attachment (regional internal LB)"
  type        = bool
  default     = false
}

variable "psc_nat_subnet_id" {
  description = "PSC NAT subnet ID (from the networking module)"
  type        = string
  default     = ""
}

variable "proxy_only_subnet_id" {
  description = "REGIONAL_MANAGED_PROXY subnet ID required by the PSC internal LB"
  type        = string
  default     = ""
}

variable "psc_accepted_projects" {
  description = "Consumer project IDs allowed to connect via PSC (empty = accept all)"
  type        = list(string)
  default     = []
}

# --- Multi-region DR ---
variable "dr_neg_id" {
  description = "Secondary-region Serverless NEG ID to attach as an additional backend for multi-region failover. Empty = single-region."
  type        = string
  default     = ""
}
