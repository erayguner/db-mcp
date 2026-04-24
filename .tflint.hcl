# TFLint Configuration for Terraform
# https://github.com/terraform-linters/tflint

config {
  # Enable all rules by default
  call_module_type    = "all"
  force               = false
  disabled_by_default = false
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

# Unused declarations — disabled because modules expose forward-looking
# interface variables (IAP, custom domains) that aren't wired up yet.
rule "terraform_unused_declarations" {
  enabled = false
}

# Version constraints are asserted at the root module (versions.tf); we don't
# duplicate them in every submodule.
rule "terraform_required_version" {
  enabled = false
}

rule "terraform_required_providers" {
  enabled = false
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

rule "google_compute_instance_invalid_machine_type" {
  enabled = true
}
