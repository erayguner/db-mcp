/**
 * Cloud Run Module — MCP BigQuery Server (Cloud Run API v2)
 *
 * Migrated from google_cloud_run_service (v1 / Knative) to
 * google_cloud_run_v2_service. The v2 resource is required to express
 * Direct VPC egress, Secret Manager volume mounts, startup CPU boost
 * and native scaling — none of which the v1 resource supports.
 *
 * STATE MIGRATION (non-destructive — Cloud Run is stateless):
 *   terraform state rm 'module.cloud_run.google_cloud_run_service.mcp_server'
 *   terraform import 'module.cloud_run.google_cloud_run_v2_service.mcp_server' \
 *     projects/PROJECT/locations/REGION/services/mcp-bigquery-server-ENV
 *   terraform plan   # expect no changes
 */

locals {
  service_name = "mcp-bigquery-server-${var.environment}"
  network_tag  = "mcp-server-${var.environment}"

  ingress_map = {
    "all"                               = "INGRESS_TRAFFIC_ALL"
    "internal"                          = "INGRESS_TRAFFIC_INTERNAL_ONLY"
    "internal-and-cloud-load-balancing" = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  }
  ingress = local.ingress_map[var.ingress_mode]

  # Runtime environment variables rendered as dynamic env blocks. Module
  # defaults first; var.extra_env_vars merged last so callers (e.g. the root
  # module wiring Model Armor) can add/override without editing this module.
  env_vars = merge({
    MCP_TRANSPORT                       = "http"
    MCP_HTTP_PORT                       = "8080"
    MCP_HTTP_HOST                       = "0.0.0.0"
    MCP_TRANSPORT_STRICT                = "streamable" # Gemini Enterprise: Streamable HTTP only, no SSE
    TENANT_CONFIG_PATH                  = "/config/tenants.yaml"
    NODE_ENV                            = var.environment == "prod" ? "production" : var.environment
    GCP_PROJECT_ID                      = var.project_id
    BIGQUERY_LOCATION                   = var.bigquery_location
    SECURITY_RATE_LIMIT_ENABLED         = "true"
    SECURITY_RATE_LIMIT_MAX_REQUESTS    = var.environment == "prod" ? "100" : "1000"
    SECURITY_PROMPT_INJECTION_DETECTION = "true"
    SECURITY_TOOL_VALIDATION_ENABLED    = "true"
    SECURITY_LOGGING_ENABLED            = "true"
    OTEL_SERVICE_NAME                   = "mcp-bigquery-server"
    OTEL_TRACES_EXPORTER                = "google_cloud_trace"
    OTEL_METRICS_EXPORTER               = "google_cloud_monitoring"
  }, var.extra_env_vars)
}

# ---------------------------------------------------------------------------
# Tenant configuration secret
# ---------------------------------------------------------------------------
# Mounted into the container as /config/tenants.yaml so the application can
# load and hot-reload per-tenant dataset policy.
resource "google_secret_manager_secret" "tenant_config" {
  project   = var.project_id
  secret_id = "mcp-tenant-config-${var.environment}"

  replication {
    auto {}
  }

  labels = {
    environment = var.environment
    component   = "mcp-bigquery-server"
  }
}

# Initial placeholder version so the secret is mountable on first apply.
# Real tenant configuration is managed out-of-band; Terraform ignores
# subsequent payload changes.
resource "google_secret_manager_secret_version" "tenant_config_initial" {
  secret      = google_secret_manager_secret.tenant_config.id
  secret_data = var.tenant_config_initial_content

  lifecycle {
    ignore_changes = [secret_data, enabled]
  }
}

# Least-privilege: grant the runtime service account access to this secret
# only (replaces a broad project-level secretAccessor grant).
resource "google_secret_manager_secret_iam_member" "tenant_config_accessor" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.tenant_config.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${var.service_account_email}"
}

# ---------------------------------------------------------------------------
# Cloud Run v2 service
# ---------------------------------------------------------------------------
resource "google_cloud_run_v2_service" "mcp_server" {
  name     = local.service_name
  location = var.region
  project  = var.project_id

  ingress             = local.ingress
  deletion_protection = var.environment == "prod"

  template {
    service_account                  = var.service_account_email
    timeout                          = var.request_timeout
    execution_environment            = "EXECUTION_ENVIRONMENT_GEN2"
    max_instance_request_concurrency = var.environment == "prod" ? 80 : 100

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    # Direct VPC egress — replaces the always-on Serverless VPC connector.
    vpc_access {
      network_interfaces {
        network    = var.network_id
        subnetwork = var.subnetwork_id
        tags       = [local.network_tag]
      }
      egress = var.vpc_egress
    }

    volumes {
      name = "tenant-config"
      secret {
        secret = google_secret_manager_secret.tenant_config.secret_id
        items {
          version = "latest"
          path    = "tenants.yaml"
        }
      }
    }

    containers {
      image = var.image

      # h2c enables end-to-end HTTP/2 for the Streamable HTTP transport.
      ports {
        name           = "h2c"
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
        # cpu_idle=false => CPU always allocated (instance billing) in prod.
        cpu_idle          = var.environment != "prod"
        startup_cpu_boost = var.startup_cpu_boost
      }

      dynamic "env" {
        for_each = local.env_vars
        content {
          name  = env.key
          value = env.value
        }
      }

      volume_mounts {
        name       = "tenant-config"
        mount_path = "/config"
      }

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

    labels = {
      environment = var.environment
      service     = "mcp-bigquery-server"
      managed-by  = "terraform"
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  dynamic "binary_authorization" {
    for_each = var.enable_binary_authorization ? [1] : []
    content {
      use_default = true
    }
  }

  lifecycle {
    # CI updates the container image via gcloud / Cloud Deploy. Terraform
    # ignores image changes so it does not revert deployments; it still
    # owns every other aspect of the service configuration.
    ignore_changes = [
      template[0].containers[0].image,
      client,
      client_version,
    ]
  }

  depends_on = [google_secret_manager_secret_version.tenant_config_initial]
}

# Public invoker binding (kept false by default — auth is enforced in-app
# and/or by IAP at the load balancer).
resource "google_cloud_run_v2_service_iam_member" "invoker" {
  count = var.allow_unauthenticated ? 1 : 0

  project  = var.project_id
  location = google_cloud_run_v2_service.mcp_server.location
  name     = google_cloud_run_v2_service.mcp_server.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Optional custom domain mapping.
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
    route_name = google_cloud_run_v2_service.mcp_server.name
  }
}
