variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "environment" {
  description = "Environment name (dev, staging, production)"
  type        = string

  validation {
    condition     = contains(["dev", "staging", "production"], var.environment)
    error_message = "Environment must be dev, staging, or production."
  }
}

variable "cloud_run_location" {
  description = "Cloud Run service location"
  type        = string
  default     = "us-central1"
}

variable "cloud_run_url" {
  description = "Cloud Run service URL for uptime checks"
  type        = string
  default     = ""
}

# ==========================================
# Notification Configuration
# ==========================================

variable "alert_email" {
  description = "Email address for alert notifications"
  type        = string
}

variable "slack_webhook_url" {
  description = "Slack webhook URL for notifications (optional)"
  type        = string
  default     = ""
  sensitive   = true
}

variable "pagerduty_service_key" {
  description = "PagerDuty service integration key (optional, production only)"
  type        = string
  default     = ""
  sensitive   = true
}

# ==========================================
# Alert Thresholds
# ==========================================

variable "error_rate_threshold" {
  description = "Error rate threshold (errors per minute)"
  type        = number
  default     = 5
}

variable "latency_threshold_ms" {
  description = "P95 latency threshold in milliseconds"
  type        = number
  default     = 2000
}

variable "auth_failure_threshold" {
  description = "Authentication failure threshold (failures per minute)"
  type        = number
  default     = 10
}

variable "max_instance_threshold" {
  description = "Maximum Cloud Run instance count before alerting"
  type        = number
  default     = 50
}

variable "memory_threshold_percent" {
  description = "Memory utilization threshold percentage"
  type        = number
  default     = 85

  validation {
    condition     = var.memory_threshold_percent > 0 && var.memory_threshold_percent <= 100
    error_message = "Memory threshold must be between 1 and 100."
  }
}

# ==========================================
# SLO Targets
# ==========================================

variable "availability_slo_target" {
  description = "Availability SLO target (e.g., 0.999 for 99.9%)"
  type        = number
  default     = 0.999

  validation {
    condition     = var.availability_slo_target > 0 && var.availability_slo_target <= 1
    error_message = "SLO target must be between 0 and 1."
  }
}

variable "latency_slo_target" {
  description = "Latency SLO target (e.g., 0.95 for 95% of requests)"
  type        = number
  default     = 0.95

  validation {
    condition     = var.latency_slo_target > 0 && var.latency_slo_target <= 1
    error_message = "SLO target must be between 0 and 1."
  }
}

# ==========================================
# Labels
# ==========================================

variable "labels" {
  description = "Additional labels to apply to monitoring resources"
  type        = map(string)
  default     = {}
}
