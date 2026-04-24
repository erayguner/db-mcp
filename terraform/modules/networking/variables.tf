variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP Region"
  type        = string
}

variable "environment" {
  description = "Environment (development, staging, production)"
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR range for VPC"
  type        = string
  default     = "10.0.0.0/24"
}

variable "enable_vpc_service_controls" {
  description = "Enable VPC Service Controls"
  type        = bool
  default     = false
}

variable "enable_cloud_armor" {
  description = "Enable Cloud Armor security policy"
  type        = bool
  default     = true
}

variable "allowed_ip_ranges" {
  description = "List of allowed IP ranges for Cloud Armor"
  type        = list(string)
  default     = ["0.0.0.0/0"] # Allow all by default, restrict in production
}

variable "access_policy_name" {
  description = "Access Context Manager policy name for VPC Service Controls"
  type        = string
  default     = ""
}

# Private Service Connect (PSC) — optional private ingress path.
# When enabled, a PSC NAT subnet is provisioned; consumers attach to the
# service attachment produced by the cloud-run module (see cloud-run/main.tf).
variable "enable_private_service_connect" {
  description = "Provision PSC NAT subnet for private ingress to Cloud Run"
  type        = bool
  default     = false
}

variable "psc_nat_subnet_cidr" {
  description = "CIDR for the PSC NAT subnet (must be disjoint from vpc_cidr)"
  type        = string
  default     = "10.0.1.0/24"
}
