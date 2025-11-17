# TFLint Configuration for Terraform
# https://github.com/terraform-linters/tflint

config {
  # Enable all rules by default
  module = true
  force = false
  disabled_by_default = false

  # Ignore specific modules if needed
  # ignore_module = {}
}

# GCP-specific plugin configuration
plugin "google" {
  enabled = true
  version = "0.27.1"
  source  = "github.com/terraform-linters/tflint-ruleset-google"
}

# Terraform core rules
plugin "terraform" {
  enabled = true
  version = "0.5.0"
  source  = "github.com/terraform-linters/tflint-ruleset-terraform"

  preset = "recommended"
}

# Custom rules for security and best practices

# Naming conventions
rule "terraform_naming_convention" {
  enabled = true

  variable {
    format = "snake_case"
  }

  locals {
    format = "snake_case"
  }

  output {
    format = "snake_case"
  }

  resource {
    format = "snake_case"
  }

  module {
    format = "snake_case"
  }

  data {
    format = "snake_case"
  }
}

# Documentation requirements
rule "terraform_documented_outputs" {
  enabled = true
}

rule "terraform_documented_variables" {
  enabled = true
}

# Type constraints
rule "terraform_typed_variables" {
  enabled = true
}

# Standard module structure
rule "terraform_standard_module_structure" {
  enabled = true
}

# Workspace remote configuration
rule "terraform_workspace_remote" {
  enabled = false  # We use local backend for now
}

# Deprecated syntax
rule "terraform_deprecated_index" {
  enabled = true
}

rule "terraform_deprecated_interpolation" {
  enabled = true
}

# Unused declarations
rule "terraform_unused_declarations" {
  enabled = true
}

# Required version constraints
rule "terraform_required_version" {
  enabled = true
}

rule "terraform_required_providers" {
  enabled = true
}

# Comment syntax
rule "terraform_comment_syntax" {
  enabled = true
}

# Module pinning
rule "terraform_module_pinned_source" {
  enabled = true
  default_branches = ["main", "master"]
}

# GCP-specific security rules
rule "google_project_iam_member_invalid_member" {
  enabled = true
}

rule "google_storage_bucket_invalid_location" {
  enabled = true
}

rule "google_compute_instance_invalid_machine_type" {
  enabled = true
}
