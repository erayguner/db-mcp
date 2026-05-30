/**
 * Model Armor Module (R9)
 *
 * Provisions a Model Armor template that screens LLM prompts/responses for
 * prompt-injection & jailbreak, malicious URIs, sensitive data (SDP) and
 * responsible-AI categories. The MCP server calls this template at runtime
 * (see src/security/model-armor.ts) via:
 *   projects/{project}/locations/{location}/templates/{template_id}:sanitizeUserPrompt
 *
 * Resources verified against hashicorp/google-beta 7.34:
 *   - google_model_armor_template      (docID 12372366)
 *   - google_model_armor_floorsetting  (docID 12372365)
 *
 * NOTE on "filter version v3": the template schema in provider 7.34 has NO
 * filter-version attribute. Model Armor's filter/detector version (v3 /
 * "Latest") is selected by the SERVICE at runtime, not pinned in Terraform.
 * We therefore surface it to the application as the MODEL_ARMOR_FILTER_VERSION
 * env var (wired from the root module / cloud-run) rather than as an HCL field.
 * The closest template-level control is template_metadata.enforcement_type
 * (INSPECT_ONLY vs INSPECT_AND_BLOCK), exposed via var.enforcement_type.
 */

terraform {
  required_providers {
    # Model Armor resources are only in google-beta as of 7.34.
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 7.34"
    }
  }
}

locals {
  template_id = "mcp-bigquery-armor-${var.environment}"
}

resource "google_model_armor_template" "mcp" {
  provider = google-beta

  project     = var.project_id
  location    = var.location
  template_id = local.template_id

  filter_config {
    # Prompt injection & jailbreak — enabled, high-confidence only (minimise
    # false positives on legitimate analytical SQL prompts).
    pi_and_jailbreak_filter_settings {
      filter_enforcement = "ENABLED"
      confidence_level   = "HIGH"
    }

    # Malicious URI detection — enabled.
    malicious_uri_filter_settings {
      filter_enforcement = "ENABLED"
    }

    # Sensitive Data Protection (basic) — opt-in via var.enable_sdp.
    dynamic "sdp_settings" {
      for_each = var.enable_sdp ? [1] : []
      content {
        basic_config {
          filter_enforcement = "ENABLED"
        }
      }
    }

    # Responsible-AI filters — opt-in via var.rai_filters. Each entry is a
    # { filter_type, confidence_level } object matching the verified schema
    # (filter_type: SEXUALLY_EXPLICIT | HATE_SPEECH | HARASSMENT | DANGEROUS).
    dynamic "rai_settings" {
      for_each = length(var.rai_filters) > 0 ? [1] : []
      content {
        dynamic "rai_filters" {
          for_each = var.rai_filters
          content {
            filter_type      = rai_filters.value.filter_type
            confidence_level = rai_filters.value.confidence_level
          }
        }
      }
    }
  }

  template_metadata {
    # INSPECT_ONLY (default) logs/inspects without blocking at the template
    # level; the app enforces fail-open/fail-closed. Set INSPECT_AND_BLOCK to
    # have Model Armor itself block tripped prompts.
    enforcement_type        = var.enforcement_type
    log_template_operations = true
    log_sanitize_operations = var.environment == "prod"
  }

  labels = {
    environment = var.environment
    component   = "mcp-bigquery-server"
    managed-by  = "terraform"
  }
}

# ---------------------------------------------------------------------------
# Floor setting (project-level minimum). Gated OFF by default.
#
# KNOWN ISSUE (provider issue #26214): google_model_armor_floorsetting has a
# destroy-persistence bug — `terraform destroy` removes the resource from state
# but the floor setting can PERSIST in the API (floor settings are a singleton
# per parent/location and the delete is effectively a reset). After destroy,
# verify with:
#   gcloud model-armor floorsettings describe --location <loc> --project <proj>
# and reset manually if needed. Enabling enforcement here applies a project-wide
# minimum to ALL Model Armor templates in the project — keep default false.
# ---------------------------------------------------------------------------
resource "google_model_armor_floorsetting" "mcp" {
  provider = google-beta
  count    = var.enable_floor_setting ? 1 : 0

  parent   = "projects/${var.project_id}"
  location = var.location

  filter_config {
    pi_and_jailbreak_filter_settings {
      filter_enforcement = "ENABLED"
      confidence_level   = "HIGH"
    }
    malicious_uri_filter_settings {
      filter_enforcement = "ENABLED"
    }
  }

  # Whether the floor setting is actually enforced project-wide. Even with the
  # resource created, keep this conservative.
  enable_floor_setting_enforcement = var.enforce_floor_setting
}
