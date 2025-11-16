#!/bin/bash
set -euo pipefail

# BigQuery MCP Server - Automated Deployment Script
# Deploys to Google Cloud Run with Workload Identity Federation

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-}"
REGION="${DEPLOY_REGION:-us-central1}"
SERVICE_NAME="bigquery-mcp-server"
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

# Functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_prerequisites() {
    log_info "Checking prerequisites..."

    # Check gcloud
    if ! command -v gcloud &> /dev/null; then
        log_error "gcloud CLI not found. Please install: https://cloud.google.com/sdk/docs/install"
        exit 1
    fi

    # Check docker
    if ! command -v docker &> /dev/null; then
        log_error "Docker not found. Please install: https://docs.docker.com/get-docker/"
        exit 1
    fi

    # Check project ID
    if [ -z "$PROJECT_ID" ]; then
        log_error "GOOGLE_CLOUD_PROJECT not set. Please export GOOGLE_CLOUD_PROJECT=your-project-id"
        exit 1
    fi

    log_info "Prerequisites OK"
}

build_image() {
    log_info "Building Docker image..."

    docker build -t "${IMAGE_NAME}:latest" -t "${IMAGE_NAME}:$(git rev-parse --short HEAD)" .

    log_info "Docker image built successfully"
}

push_image() {
    log_info "Pushing image to Container Registry..."

    # Configure Docker for GCR
    gcloud auth configure-docker --quiet

    # Push both tags
    docker push "${IMAGE_NAME}:latest"
    docker push "${IMAGE_NAME}:$(git rev-parse --short HEAD)"

    log_info "Image pushed successfully"
}

deploy_cloud_run() {
    log_info "Deploying to Cloud Run..."

    # Get service account
    SERVICE_ACCOUNT="mcp-server-prod@${PROJECT_ID}.iam.gserviceaccount.com"

    # Check if service account exists
    if ! gcloud iam service-accounts describe "$SERVICE_ACCOUNT" &> /dev/null; then
        log_warn "Service account $SERVICE_ACCOUNT not found. Creating..."

        gcloud iam service-accounts create mcp-server-prod \
            --display-name="BigQuery MCP Server - Production" \
            --description="Service account for BigQuery MCP Server (WIF-based)"

        # Grant BigQuery permissions
        gcloud projects add-iam-policy-binding "$PROJECT_ID" \
            --member="serviceAccount:$SERVICE_ACCOUNT" \
            --role="roles/bigquery.dataViewer" \
            --quiet

        gcloud projects add-iam-policy-binding "$PROJECT_ID" \
            --member="serviceAccount:$SERVICE_ACCOUNT" \
            --role="roles/bigquery.jobUser" \
            --quiet

        log_info "Service account created and permissions granted"
    fi

    # Deploy to Cloud Run
    gcloud run deploy "$SERVICE_NAME" \
        --image "${IMAGE_NAME}:latest" \
        --platform managed \
        --region "$REGION" \
        --service-account "$SERVICE_ACCOUNT" \
        --allow-unauthenticated \
        --cpu 2 \
        --memory 2Gi \
        --timeout 300 \
        --concurrency 80 \
        --min-instances 1 \
        --max-instances 10 \
        --set-env-vars "GOOGLE_CLOUD_PROJECT=${PROJECT_ID}" \
        --set-env-vars "WIF_POOL_ID=bigquery-mcp-pool" \
        --set-env-vars "WIF_PROVIDER_ID=cloud-run-identity" \
        --set-env-vars "WIF_SERVICE_ACCOUNT=${SERVICE_ACCOUNT}" \
        --set-env-vars "LOG_LEVEL=info" \
        --set-env-vars "ENABLE_TELEMETRY=true" \
        --set-env-vars "ENABLE_PERMISSION_VALIDATION=true" \
        --quiet

    log_info "Deployment completed successfully"
}

verify_deployment() {
    log_info "Verifying deployment..."

    # Get service URL
    SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" \
        --platform managed \
        --region "$REGION" \
        --format 'value(status.url)')

    log_info "Service URL: $SERVICE_URL"

    # Wait for service to be ready
    log_info "Waiting for service to be ready..."
    sleep 10

    # Health check
    if curl -s -f "${SERVICE_URL}/health/live" > /dev/null; then
        log_info "✓ Liveness check passed"
    else
        log_error "✗ Liveness check failed"
        exit 1
    fi

    if curl -s -f "${SERVICE_URL}/health/ready" > /dev/null; then
        log_info "✓ Readiness check passed"
    else
        log_warn "✗ Readiness check failed (service may still be starting)"
    fi

    # Full health check
    HEALTH_RESPONSE=$(curl -s "${SERVICE_URL}/health")
    HEALTH_STATUS=$(echo "$HEALTH_RESPONSE" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)

    if [ "$HEALTH_STATUS" = "healthy" ]; then
        log_info "✓ Full health check passed - Service is healthy"
    else
        log_warn "Service health status: $HEALTH_STATUS"
    fi

    log_info "Deployment verification complete"
}

print_summary() {
    SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" \
        --platform managed \
        --region "$REGION" \
        --format 'value(status.url)')

    echo ""
    echo "=========================================="
    echo "Deployment Summary"
    echo "=========================================="
    echo "Service: $SERVICE_NAME"
    echo "Region: $REGION"
    echo "Project: $PROJECT_ID"
    echo "URL: $SERVICE_URL"
    echo ""
    echo "Health Endpoints:"
    echo "  Liveness:  ${SERVICE_URL}/health/live"
    echo "  Readiness: ${SERVICE_URL}/health/ready"
    echo "  Full:      ${SERVICE_URL}/health"
    echo ""
    echo "View logs:"
    echo "  gcloud logging tail 'resource.type=cloud_run_revision AND resource.labels.service_name=${SERVICE_NAME}'"
    echo ""
    echo "Monitor service:"
    echo "  gcloud run services describe ${SERVICE_NAME} --region ${REGION}"
    echo "=========================================="
}

# Main execution
main() {
    log_info "Starting deployment of BigQuery MCP Server"

    check_prerequisites
    build_image
    push_image
    deploy_cloud_run
    verify_deployment
    print_summary

    log_info "Deployment completed successfully! 🎉"
}

# Run main function
main "$@"
