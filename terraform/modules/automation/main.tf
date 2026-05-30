/**
 * Automation / HITL Module (R17/R18) — feature-flagged, default OFF.
 *
 * Scaffolds an event-driven remediation pipeline with human-in-the-loop
 * approval for high-cost / DML / destructive actions. ENTIRELY gated behind
 * var.enable_automation (the root module sets count = enable_automation ? 1:0),
 * so nothing here is created unless explicitly turned on.
 *
 * Components:
 *   - google_pubsub_topic + _subscription  remediation event bus. The
 *       subscription uses a message_transforms (SMT) block — VERIFIED to exist
 *       in hashicorp/google 7.34 (field name: `message_transforms`, supporting
 *       `javascript_udf` and `ai_inference`). We ship a PII-redaction
 *       javascript_udf SMT; an optional Vertex AI-inference SMT can be enabled.
 *   - google_cloud_run_v2_worker_pool       pull-based remediation worker.
 *       VERIFIED to exist in 7.34 (docID 12373418). Scales to 0 by default
 *       (manual_instance_count = 0) so it is inert until staffed.
 *   - google_workflows_workflow             callback-based HITL approval flow
 *       (workflows/hitl-approval.yaml).
 *   - google_secret_manager_secret          Slack webhook URL (value managed
 *       out-of-band; no version is created here).
 *   - dedicated least-privilege service account for the worker.
 */

terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.34"
    }
  }
}

locals {
  name_prefix = "mcp-remediation-${var.environment}"
}

# ---------------------------------------------------------------------------
# Dedicated least-privilege service account for the remediation worker.
# ---------------------------------------------------------------------------
resource "google_service_account" "worker" {
  project      = var.project_id
  account_id   = "mcp-remediation-${var.environment}"
  display_name = "MCP remediation worker (${var.environment})"
  description  = "Least-privilege identity for the Cloud Run remediation worker pool"
}

# Subscribe to the remediation topic (pull). Scoped to this subscription only.
resource "google_pubsub_subscription_iam_member" "worker_subscriber" {
  project      = var.project_id
  subscription = google_pubsub_subscription.remediation.name
  role         = "roles/pubsub.subscriber"
  member       = "serviceAccount:${google_service_account.worker.email}"
}

# Allow the worker to trigger the HITL workflow (invoker only — not admin).
resource "google_project_iam_member" "worker_workflows_invoker" {
  project = var.project_id
  role    = "roles/workflows.invoker"
  member  = "serviceAccount:${google_service_account.worker.email}"
}

# Allow the worker to read the Slack webhook secret (this secret only).
resource "google_secret_manager_secret_iam_member" "worker_slack_accessor" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.slack_webhook.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.worker.email}"
}

# ---------------------------------------------------------------------------
# Remediation event bus.
# ---------------------------------------------------------------------------
resource "google_pubsub_topic" "remediation" {
  project = var.project_id
  name    = "${local.name_prefix}-events"

  labels = {
    environment = var.environment
    component   = "mcp-remediation"
    managed-by  = "terraform"
  }
}

resource "google_pubsub_subscription" "remediation" {
  project = var.project_id
  name    = "${local.name_prefix}-worker"
  topic   = google_pubsub_topic.remediation.id

  ack_deadline_seconds       = 60
  message_retention_duration = "86400s" # 24h

  # Single Message Transform (SMT) — VERIFIED `message_transforms` block in
  # provider 7.34. PII-redaction UDF strips an `ssn` field before the worker
  # ever sees the payload (defense-in-depth at the bus layer).
  message_transforms {
    javascript_udf {
      function_name = "redactPII"
      code          = <<-EOF
        function redactPII(message, metadata) {
          try {
            const data = JSON.parse(message.data);
            delete data['ssn'];
            delete data['email'];
            message.data = JSON.stringify(data);
          } catch (e) {
            // Non-JSON payload: pass through unchanged.
          }
          return message;
        }
      EOF
    }
  }

  # Optional Vertex AI-inference SMT (classify/triage remediation events with a
  # Gemini model). Off by default; the endpoint/model is var-driven. Uses the
  # VERIFIED ai_inference block of message_transforms.
  dynamic "message_transforms" {
    for_each = var.enable_ai_inference_smt && var.ai_inference_endpoint != "" ? [1] : []
    content {
      ai_inference {
        endpoint              = var.ai_inference_endpoint
        service_account_email = google_service_account.worker.email
        unstructured_inference {
          parameters = {
            "max_tokens" = 1024
          }
        }
      }
    }
  }

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  expiration_policy {
    ttl = "" # never expire
  }
}

# ---------------------------------------------------------------------------
# Slack webhook secret (value injected out-of-band; no version created here).
# ---------------------------------------------------------------------------
resource "google_secret_manager_secret" "slack_webhook" {
  project   = var.project_id
  secret_id = "${local.name_prefix}-slack-webhook"

  replication {
    auto {}
  }

  labels = {
    environment = var.environment
    component   = "mcp-remediation"
    managed-by  = "terraform"
  }
}

# ---------------------------------------------------------------------------
# HITL approval workflow (callback-based).
# ---------------------------------------------------------------------------
resource "google_workflows_workflow" "hitl_approval" {
  project         = var.project_id
  name            = "${local.name_prefix}-hitl-approval"
  region          = var.region
  description     = "Human-in-the-loop approval for high-cost/DML/destructive remediation"
  service_account = google_service_account.worker.id
  call_log_level  = "LOG_ERRORS_ONLY"

  # Non-prod: allow destroy without flipping the flag. Prod stays protected.
  deletion_protection = var.environment == "prod"

  source_contents = file("${path.module}/workflows/hitl-approval.yaml")

  labels = {
    environment = var.environment
    component   = "mcp-remediation"
    managed-by  = "terraform"
  }
}

# ---------------------------------------------------------------------------
# Remediation worker (pull-based). VERIFIED google_cloud_run_v2_worker_pool.
# Scales to 0 by default so it is inert until intentionally staffed.
# ---------------------------------------------------------------------------
resource "google_cloud_run_v2_worker_pool" "remediation" {
  provider = google

  name     = "${local.name_prefix}-worker"
  location = var.region
  project  = var.project_id

  # Non-prod can be torn down freely; prod is protected by default.
  deletion_protection = var.environment == "prod"

  template {
    service_account = google_service_account.worker.email

    containers {
      image = var.worker_image

      env {
        name  = "REMEDIATION_SUBSCRIPTION"
        value = google_pubsub_subscription.remediation.name
      }
      env {
        name  = "HITL_WORKFLOW"
        value = google_workflows_workflow.hitl_approval.name
      }
      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "ENVIRONMENT"
        value = var.environment
      }
      env {
        name = "SLACK_WEBHOOK_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.slack_webhook.secret_id
            version = "latest"
          }
        }
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }
  }

  # MANUAL scaling pinned to var.worker_instance_count (default 0 = idle).
  scaling {
    scaling_mode          = "MANUAL"
    manual_instance_count = var.worker_instance_count
  }

  # Image is deployed/updated out-of-band (CI/gcloud); Terraform owns the rest.
  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      client,
      client_version,
    ]
  }

  depends_on = [
    google_secret_manager_secret_iam_member.worker_slack_accessor,
    google_pubsub_subscription_iam_member.worker_subscriber,
  ]
}
