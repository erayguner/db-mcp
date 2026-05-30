variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "Region for the worker pool and workflow"
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

variable "worker_image" {
  description = <<-EOT
    Container image for the remediation worker pool (Artifact Registry path,
    ideally pinned to a digest). A placeholder is used by default; the real
    image is deployed out-of-band (Terraform ignores image changes).
  EOT
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/worker-pool"
}

variable "worker_instance_count" {
  description = "MANUAL-scaling instance count for the worker pool. Default 0 = idle/no running instances (dry-run posture)."
  type        = number
  default     = 0
}

variable "enable_ai_inference_smt" {
  description = "Add a Vertex AI-inference single-message-transform (SMT) to the remediation subscription. Default false."
  type        = bool
  default     = false
}

variable "ai_inference_endpoint" {
  description = <<-EOT
    Vertex AI model/endpoint for the optional AI-inference SMT, e.g.
    projects/{p}/locations/{l}/publishers/google/models/gemini-2.5-flash.
    Required (non-empty) for the AI-inference SMT to be created.
  EOT
  type        = string
  default     = ""
}
