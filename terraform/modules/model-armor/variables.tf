variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "location" {
  description = "Model Armor template location (region, e.g. europe-west2). Must match the location the app uses in MODEL_ARMOR_TEMPLATE / MODEL_ARMOR_LOCATION."
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

variable "enforcement_type" {
  description = "Template enforcement_type: INSPECT_ONLY (inspect/log only) or INSPECT_AND_BLOCK (Model Armor blocks tripped prompts)."
  type        = string
  default     = "INSPECT_ONLY"

  validation {
    condition     = contains(["INSPECT_ONLY", "INSPECT_AND_BLOCK"], var.enforcement_type)
    error_message = "enforcement_type must be INSPECT_ONLY or INSPECT_AND_BLOCK."
  }
}

variable "enable_sdp" {
  description = "Enable Sensitive Data Protection (basic) filtering in the template."
  type        = bool
  default     = false
}

variable "rai_filters" {
  description = <<-EOT
    Optional Responsible-AI filters. Each entry: { filter_type, confidence_level }.
    filter_type ∈ SEXUALLY_EXPLICIT | HATE_SPEECH | HARASSMENT | DANGEROUS.
    confidence_level ∈ LOW_AND_ABOVE | MEDIUM_AND_ABOVE | HIGH.
  EOT
  type = list(object({
    filter_type      = string
    confidence_level = string
  }))
  default = []
}

variable "enable_floor_setting" {
  description = <<-EOT
    Create the project-level Model Armor floor setting. Default false. WARNING:
    floor settings apply a project-wide minimum to ALL Model Armor templates and
    have a known destroy-persistence bug (provider issue #26214) — see main.tf.
  EOT
  type        = bool
  default     = false
}

variable "enforce_floor_setting" {
  description = "When enable_floor_setting=true, set enable_floor_setting_enforcement on the floor setting. Default false (created but not enforced)."
  type        = bool
  default     = false
}
