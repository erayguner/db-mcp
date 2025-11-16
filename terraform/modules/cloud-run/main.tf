/**
 * Cloud Run Module - MCP BigQuery Server Deployment
 *
 * Deploys the MCP server on Cloud Run with:
 * - Security-hardened configuration
 * - Auto-scaling based on demand
 * - Environment-specific settings
 * - VPC egress control
 * - Cloud Armor protection
 */

# Cloud Run Service
resource "google_cloud_run_service" "mcp_server" {
  name     = "mcp-bigquery-server-${var.environment}"
  location = var.region
  project  = var.project_id

  template {
    spec {
      service_account_name = var.service_account_email

      containers {
        image = var.image

        resources {
          limits = {
            cpu    = var.cpu
            memory = var.memory
          }
        }

        # Environment variables for security configuration
        env {
          name  = "NODE_ENV"
          value = var.environment
        }

        env {
          name  = "GCP_PROJECT_ID"
          value = var.project_id
        }

        env {
          name  = "BIGQUERY_LOCATION"
          value = var.bigquery_location
        }

        # Security settings
        env {
          name  = "SECURITY_RATE_LIMIT_ENABLED"
          value = "true"
        }

        env {
          name  = "SECURITY_RATE_LIMIT_MAX_REQUESTS"
          value = var.environment == "production" ? "100" : "1000"
        }

        env {
          name  = "SECURITY_PROMPT_INJECTION_DETECTION"
          value = "true"
        }

        env {
          name  = "SECURITY_TOOL_VALIDATION_ENABLED"
          value = "true"
        }

        env {
          name  = "SECURITY_LOGGING_ENABLED"
          value = "true"
        }

        # OpenTelemetry settings
        env {
          name  = "OTEL_SERVICE_NAME"
          value = "mcp-bigquery-server"
        }

        env {
          name  = "OTEL_TRACES_EXPORTER"
          value = "google_cloud_trace"
        }

        env {
          name  = "OTEL_METRICS_EXPORTER"
          value = "google_cloud_monitoring"
        }

        # Port configuration
        ports {
          name           = "h2c"
          container_port = 8080
        }

        # Startup probe
        startup_probe {
          http_get {
            path = "/health"
            port = 8080
          }
          initial_delay_seconds = 10
          timeout_seconds       = 5
          period_seconds        = 10
          failure_threshold     = 3
        }

        # Liveness probe
        liveness_probe {
          http_get {
            path = "/health"
            port = 8080
          }
          initial_delay_seconds = 30
          timeout_seconds       = 5
          period_seconds        = 30
          failure_threshold     = 3
        }
      }

      # Container concurrency - limit requests per container
      container_concurrency = var.environment == "production" ? 80 : 100

      # Timeout for requests
      timeout_seconds = 300 # 5 minutes
    }

    metadata {
      annotations = {
        # VPC egress through connector
        "run.googleapis.com/vpc-access-connector" = var.vpc_connector_id
        "run.googleapis.com/vpc-access-egress"    = "private-ranges-only"

        # Auto-scaling configuration
        "autoscaling.knative.dev/minScale" = tostring(var.min_instances)
        "autoscaling.knative.dev/maxScale" = tostring(var.max_instances)

        # CPU throttling - only allocate CPU during requests
        "run.googleapis.com/cpu-throttling" = var.environment == "production" ? "false" : "true"

        # Execution environment (second generation)
        "run.googleapis.com/execution-environment" = "gen2"

        # Binary authorization
        "run.googleapis.com/binary-authorization" = var.enable_binary_authorization ? "default" : "disabled"
      }

      labels = {
        environment = var.environment
        service     = "mcp-bigquery-server"
        managed-by  = "terraform"
      }
    }
  }

  traffic {
    percent         = 100
    latest_revision = true
  }

  autogenerate_revision_name = true

  lifecycle {
    ignore_changes = [
      template[0].metadata[0].annotations["run.googleapis.com/client-name"],
      template[0].metadata[0].annotations["run.googleapis.com/client-version"],
    ]
  }
}

# IAM policy for Cloud Run service
resource "google_cloud_run_service_iam_member" "invoker" {
  count = var.allow_unauthenticated ? 1 : 0

  service  = google_cloud_run_service.mcp_server.name
  location = google_cloud_run_service.mcp_server.location
  role     = "roles/run.invoker"
  member   = "allUsers"

  project = var.project_id
}

# Cloud Run domain mapping (if custom domain provided)
resource "google_cloud_run_domain_mapping" "mcp_domain" {
  count = var.custom_domain != "" ? 1 : 0

  location = var.region
  name     = var.custom_domain
  project  = var.project_id

  metadata {
    namespace = var.project_id
    labels = {
      environment = var.environment
    }
  }

  spec {
    route_name = google_cloud_run_service.mcp_server.name
  }
}

# Load Balancer (if Cloud Armor is enabled)
resource "google_compute_region_network_endpoint_group" "mcp_neg" {
  count = var.cloud_armor_policy_id != null ? 1 : 0

  name                  = "mcp-bigquery-neg-${var.environment}"
  network_endpoint_type = "SERVERLESS"
  region                = var.region
  project               = var.project_id

  cloud_run {
    service = google_cloud_run_service.mcp_server.name
  }
}

resource "google_compute_backend_service" "mcp_backend" {
  count = var.cloud_armor_policy_id != null ? 1 : 0

  name    = "mcp-bigquery-backend-${var.environment}"
  project = var.project_id

  protocol    = "HTTP"
  port_name   = "http"
  timeout_sec = 300

  backend {
    group = google_compute_region_network_endpoint_group.mcp_neg[0].id
  }

  security_policy = var.cloud_armor_policy_id

  log_config {
    enable      = true
    sample_rate = var.environment == "production" ? 0.5 : 1.0
  }

  iap {
    oauth2_client_id     = var.iap_client_id
    oauth2_client_secret = var.iap_client_secret
  }
}

resource "google_compute_url_map" "mcp_url_map" {
  count = var.cloud_armor_policy_id != null ? 1 : 0

  name            = "mcp-bigquery-urlmap-${var.environment}"
  project         = var.project_id
  default_service = google_compute_backend_service.mcp_backend[0].id
}

resource "google_compute_target_https_proxy" "mcp_https_proxy" {
  count = var.cloud_armor_policy_id != null && var.ssl_certificate_id != "" ? 1 : 0

  name    = "mcp-bigquery-https-proxy-${var.environment}"
  project = var.project_id
  url_map = google_compute_url_map.mcp_url_map[0].id

  ssl_certificates = [var.ssl_certificate_id]
}

resource "google_compute_global_forwarding_rule" "mcp_https" {
  count = var.cloud_armor_policy_id != null && var.ssl_certificate_id != "" ? 1 : 0

  name       = "mcp-bigquery-https-${var.environment}"
  project    = var.project_id
  target     = google_compute_target_https_proxy.mcp_https_proxy[0].id
  port_range = "443"
  ip_address = var.static_ip_address
}

# Service logs sink (for security audit logging)
resource "google_logging_project_sink" "mcp_security_logs" {
  name        = "mcp-bigquery-security-logs-${var.environment}"
  project     = var.project_id
  destination = "bigquery.googleapis.com/projects/${var.project_id}/datasets/mcp_security_logs_${var.environment}"

  filter = <<-EOT
    resource.type="cloud_run_revision"
    resource.labels.service_name="${google_cloud_run_service.mcp_server.name}"
    (
      jsonPayload.securityEvent=true OR
      jsonPayload.severity="critical" OR
      jsonPayload.severity="high"
    )
  EOT

  unique_writer_identity = true

  bigquery_options {
    use_partitioned_tables = true
  }
}

# Create BigQuery dataset for security logs
resource "google_bigquery_dataset" "security_logs" {
  dataset_id  = "mcp_security_logs_${var.environment}"
  project     = var.project_id
  location    = var.bigquery_location
  description = "Security audit logs for MCP BigQuery server - ${var.environment}"

  default_table_expiration_ms = 7776000000 # 90 days

  labels = {
    environment = var.environment
    purpose     = "security-logs"
  }
}

# Grant log sink permission to write to BigQuery
resource "google_bigquery_dataset_iam_member" "log_sink_writer" {
  dataset_id = google_bigquery_dataset.security_logs.dataset_id
  role       = "roles/bigquery.dataEditor"
  member     = google_logging_project_sink.mcp_security_logs.writer_identity
  project    = var.project_id
}
