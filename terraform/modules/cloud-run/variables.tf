variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP Region for Cloud Run service"
  type        = string
}

variable "environment" {
  description = "Environment (development, staging, production)"
  type        = string
}

variable "service_account_email" {
  description = "Service account email for Cloud Run"
  type        = string
}

variable "image" {
  description = "Container image URL"
  type        = string
}

variable "cpu" {
  description = "CPU allocation for Cloud Run"
  type        = string
  default     = "1"
}

variable "memory" {
  description = "Memory allocation for Cloud Run"
  type        = string
  default     = "512Mi"
}

variable "min_instances" {
  description = "Minimum number of instances"
  type        = number
  default     = 0
}

variable "max_instances" {
  description = "Maximum number of instances"
  type        = number
  default     = 10
}

variable "vpc_connector_id" {
  description = "VPC Access Connector ID"
  type        = string
}

variable "cloud_armor_policy_id" {
  description = "Cloud Armor security policy ID"
  type        = string
  default     = null
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
  description = "SSL certificate ID for HTTPS"
  type        = string
  default     = ""
}

variable "static_ip_address" {
  description = "Static IP address for load balancer"
  type        = string
  default     = ""
}

# Private Service Connect configuration. When enabled, a PSC service
# attachment is created in front of the Cloud Run backend so consumer
# projects can connect privately without traversing the public internet.
variable "enable_private_service_connect" {
  description = "Expose Cloud Run via a PSC service attachment"
  type        = bool
  default     = false
}

variable "psc_nat_subnet_id" {
  description = "PSC NAT subnet ID (output from the networking module)"
  type        = string
  default     = ""
}

variable "psc_accepted_projects" {
  description = "Consumer project IDs allowed to connect to the PSC service attachment"
  type        = list(string)
  default     = []
}

variable "ingress_mode" {
  description = "Cloud Run ingress mode: all, internal, or internal-and-cloud-load-balancing"
  type        = string
  default     = "all"
  validation {
    condition     = contains(["all", "internal", "internal-and-cloud-load-balancing"], var.ingress_mode)
    error_message = "ingress_mode must be one of: all, internal, internal-and-cloud-load-balancing."
  }
}
