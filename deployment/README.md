# Deployment Guide - BigQuery MCP Server

This guide covers deploying the BigQuery MCP Server to Google Cloud Run using Workload Identity Federation.

## Prerequisites

1. **GCP Project** with billing enabled
2. **gcloud CLI** installed and authenticated
3. **Docker** installed locally
4. **Workload Identity Federation** configured (see [WIF Deployment Guide](../docs/wif-deployment-guide.md))

## Quick Deployment

```bash
# Set variables
export PROJECT_ID="your-project-id"
export REGION="us-central1"
export SERVICE_NAME="bigquery-mcp-server"
export SERVICE_ACCOUNT="mcp-server-prod@${PROJECT_ID}.iam.gserviceaccount.com"

# Build and deploy
./deployment/deploy.sh
```

## Manual Deployment Steps

### 1. Build Docker Image

```bash
# Build image
docker build -t gcr.io/${PROJECT_ID}/${SERVICE_NAME}:latest .

# Test locally
docker run -p 8080:8080 \
  -e GOOGLE_CLOUD_PROJECT=${PROJECT_ID} \
  gcr.io/${PROJECT_ID}/${SERVICE_NAME}:latest

# Push to Container Registry
docker push gcr.io/${PROJECT_ID}/${SERVICE_NAME}:latest
```

### 2. Deploy to Cloud Run

```bash
# Deploy using gcloud
gcloud run deploy ${SERVICE_NAME} \
  --image gcr.io/${PROJECT_ID}/${SERVICE_NAME}:latest \
  --platform managed \
  --region ${REGION} \
  --service-account ${SERVICE_ACCOUNT} \
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
  --set-env-vars "WIF_SERVICE_ACCOUNT=${SERVICE_ACCOUNT}"
```

Or using the YAML configuration:

```bash
# Update cloud-run.yaml with your PROJECT_ID
sed -i "s/PROJECT_ID/${PROJECT_ID}/g" deployment/cloud-run.yaml

# Deploy
gcloud run services replace deployment/cloud-run.yaml \
  --platform managed \
  --region ${REGION}
```

### 3. Verify Deployment

```bash
# Get service URL
SERVICE_URL=$(gcloud run services describe ${SERVICE_NAME} \
  --platform managed \
  --region ${REGION} \
  --format 'value(status.url)')

# Health check
curl ${SERVICE_URL}/health

# Liveness check
curl ${SERVICE_URL}/health/live

# Readiness check
curl ${SERVICE_URL}/health/ready
```

## Configuration

### Environment Variables

| Variable                       | Required | Default | Description               |
| ------------------------------ | -------- | ------- | ------------------------- |
| `GOOGLE_CLOUD_PROJECT`         | Yes      | -       | GCP Project ID            |
| `WIF_POOL_ID`                  | Yes      | -       | Workload Identity Pool ID |
| `WIF_PROVIDER_ID`              | Yes      | -       | WIF Provider ID           |
| `WIF_SERVICE_ACCOUNT`          | Yes      | -       | Service account email     |
| `PORT`                         | No       | 8080    | HTTP port                 |
| `LOG_LEVEL`                    | No       | info    | Logging level             |
| `POOL_MIN_CONNECTIONS`         | No       | 2       | Min connection pool size  |
| `POOL_MAX_CONNECTIONS`         | No       | 10      | Max connection pool size  |
| `CACHE_SIZE`                   | No       | 1000    | Cache size                |
| `CACHE_TTL_MS`                 | No       | 3600000 | Cache TTL (1 hour)        |
| `ENABLE_TELEMETRY`             | No       | true    | Enable OpenTelemetry      |
| `ENABLE_PERMISSION_VALIDATION` | No       | true    | Enable permission checks  |

### Resource Configuration

**Production (Recommended)**:

- CPU: 2 vCPU
- Memory: 2 GiB
- Min instances: 1
- Max instances: 10
- Concurrency: 80

**Development**:

- CPU: 1 vCPU
- Memory: 1 GiB
- Min instances: 0
- Max instances: 3
- Concurrency: 40

## Monitoring

### Cloud Monitoring Metrics

```bash
# View metrics
gcloud monitoring dashboards list

# Create custom dashboard
gcloud monitoring dashboards create --config-from-file monitoring/dashboard.json
```

### Logs

```bash
# View logs
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=${SERVICE_NAME}" \
  --limit 50 \
  --format json

# Follow logs in real-time
gcloud logging tail "resource.type=cloud_run_revision AND resource.labels.service_name=${SERVICE_NAME}"

# Filter by severity
gcloud logging read "resource.type=cloud_run_revision AND severity>=ERROR" \
  --limit 20
```

### Alerting

```bash
# Create uptime check
gcloud monitoring uptime create ${SERVICE_NAME}-uptime \
  --display-name="${SERVICE_NAME} Uptime Check" \
  --http-check-path=/health/live \
  --period=60 \
  --timeout=10s \
  --resource-type=gce_instance \
  --checked-region=usa
```

## Scaling

### Manual Scaling

```bash
# Update min/max instances
gcloud run services update ${SERVICE_NAME} \
  --min-instances 2 \
  --max-instances 20 \
  --region ${REGION}
```

### Auto-scaling Configuration

Cloud Run automatically scales based on:

- Request concurrency (default: 80)
- CPU utilization
- Memory usage

Configure in `cloud-run.yaml`:

```yaml
annotations:
  autoscaling.knative.dev/target: '80'
  autoscaling.knative.dev/minScale: '1'
  autoscaling.knative.dev/maxScale: '10'
```

## Security

### IAM Permissions

Service account needs:

```bash
# BigQuery permissions
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/bigquery.dataViewer"

gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/bigquery.jobUser"

# Monitoring permissions
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/monitoring.metricWriter"
```

### VPC Configuration (Optional)

```bash
# Create VPC connector
gcloud compute networks vpc-access connectors create bigquery-mcp-connector \
  --region ${REGION} \
  --subnet bigquery-mcp-subnet \
  --min-instances 2 \
  --max-instances 10

# Update service
gcloud run services update ${SERVICE_NAME} \
  --vpc-connector bigquery-mcp-connector \
  --vpc-egress private-ranges-only \
  --region ${REGION}
```

## Troubleshooting

### Common Issues

**1. Service not starting**

```bash
# Check startup logs
gcloud logging read "resource.type=cloud_run_revision AND severity>=WARNING" \
  --limit 50
```

**2. Permission denied errors**

```bash
# Verify service account permissions
gcloud projects get-iam-policy ${PROJECT_ID} \
  --flatten="bindings[].members" \
  --filter="bindings.members:serviceAccount:${SERVICE_ACCOUNT}"
```

**3. High latency**

```bash
# Check instance count
gcloud run services describe ${SERVICE_NAME} \
  --platform managed \
  --region ${REGION} \
  --format='value(status.conditions)'

# Increase min instances
gcloud run services update ${SERVICE_NAME} \
  --min-instances 2 \
  --region ${REGION}
```

**4. Memory issues**

```bash
# Check memory metrics
gcloud monitoring time-series list \
  --filter='metric.type="run.googleapis.com/container/memory/utilization"'

# Increase memory
gcloud run services update ${SERVICE_NAME} \
  --memory 4Gi \
  --region ${REGION}
```

## CI/CD Integration

### GitHub Actions

See `.github/workflows/deploy.yml` for automated deployment.

### Cloud Build

```bash
# Submit build
gcloud builds submit --config cloudbuild.yaml .
```

## Rollback

```bash
# List revisions
gcloud run revisions list --service ${SERVICE_NAME} --region ${REGION}

# Rollback to previous revision
gcloud run services update-traffic ${SERVICE_NAME} \
  --to-revisions REVISION_NAME=100 \
  --region ${REGION}
```

## Cost Optimization

1. **Right-size resources**: Start with 1 vCPU, 1 GiB
2. **Optimize min instances**: Use 0 for dev, 1+ for prod
3. **Enable request caching**: Reduces BigQuery API calls
4. **Monitor cold starts**: Increase min instances if needed
5. **Use VPC connector**: Only if private networking required

## Support

- Documentation: `/docs`
- Issues: GitHub Issues
- Monitoring: Cloud Console
