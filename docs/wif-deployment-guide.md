# Workload Identity Federation Deployment Guide

## 🎯 Overview

This guide provides step-by-step instructions for deploying the GCP BigQuery MCP Server with Workload Identity
Federation authentication.

## 📋 Prerequisites Checklist

- [ ] GCP Project created
- [ ] Billing enabled on project
- [ ] Terraform >= 1.5.0 installed
- [ ] gcloud CLI installed and authenticated
- [ ] Google Workspace admin access (for OIDC setup)
- [ ] Docker installed (for building container image)
- [ ] Git repository for source code

## 🔐 Phase 1: Google Workspace OIDC Configuration

### Step 1.1: Create OAuth 2.0 Client

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Select your project
3. Navigate to **APIs & Services** > **Credentials**
4. Click **+ CREATE CREDENTIALS** > **OAuth client ID**
5. Configure:
   - **Application type**: Web application
   - **Name**: `MCP BigQuery Server - WIF`
   - **Authorized JavaScript origins**: (leave empty)
   - **Authorized redirect URIs**:
     - `https://console.cloud.google.com/`
     - `http://localhost:8080` (for local testing)
6. Click **CREATE**
7. **Save the Client ID** (format: `123456789-abc...xyz.apps.googleusercontent.com`)

### Step 1.2: Configure OAuth Consent Screen

1. Navigate to **APIs & Services** > **OAuth consent screen**
2. Select **Internal** (for Google Workspace users only)
3. Configure:
   - **App name**: MCP BigQuery Server
   - **User support email**: Your email
   - **Developer contact email**: Your email
   - **Authorized domains**: Add your Google Workspace domain
4. Click **SAVE AND CONTINUE**
5. **Scopes**: Add these scopes:
   - `openid`
   - `email`
   - `profile`
6. Click **SAVE AND CONTINUE**
7. Review and **BACK TO DASHBOARD**

## 📦 Phase 2: Infrastructure Setup

### Step 2.1: Clone Repository and Prepare

```bash
# Clone repository
git clone https://github.com/your-org/db-mcp.git
cd db-mcp

# Navigate to Terraform directory
cd terraform
```

### Step 2.2: Create GCS Backend for Terraform State

```bash
# Set project ID
export PROJECT_ID="your-gcp-project-id"
export REGION="europe-west2"

# Create GCS bucket for Terraform state
gsutil mb -p ${PROJECT_ID} -l ${REGION} gs://${PROJECT_ID}-terraform-state

# Enable versioning for state recovery
gsutil versioning set on gs://${PROJECT_ID}-terraform-state

# Enable object lifecycle management (optional)
cat > lifecycle.json << 'EOF'
{
  "lifecycle": {
    "rule": [
      {
        "action": {"type": "Delete"},
        "condition": {
          "age": 90,
          "matchesPrefix": ["archive/"]
        }
      }
    ]
  }
}
EOF

gsutil lifecycle set lifecycle.json gs://${PROJECT_ID}-terraform-state
```

### Step 2.3: Enable Required APIs

```bash
# Enable all required GCP APIs
gcloud services enable \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  cloudresourcemanager.googleapis.com \
  bigquery.googleapis.com \
  bigquerystorage.googleapis.com \
  run.googleapis.com \
  compute.googleapis.com \
  vpcaccess.googleapis.com \
  servicenetworking.googleapis.com \
  secretmanager.googleapis.com \
  logging.googleapis.com \
  monitoring.googleapis.com \
  cloudkms.googleapis.com \
  --project=${PROJECT_ID}
```

### Step 2.4: Configure Environment

```bash
# Navigate to environment directory
cd environments/dev

# Create backend configuration
cat > backend.tfvars << EOF
bucket  = "${PROJECT_ID}-terraform-state"
prefix  = "terraform/state/dev"
EOF

# Create terraform.tfvars
cat > terraform.tfvars << EOF
project_id                  = "${PROJECT_ID}"
region                      = "europe-west2"
environment                 = "dev"
google_workspace_domain     = "your-company.com"  # CHANGE THIS
google_workspace_client_id  = "YOUR_CLIENT_ID"     # FROM STEP 1.1
github_repo                 = "your-org/db-mcp"    # OPTIONAL
cloud_run_container_image   = "gcr.io/${PROJECT_ID}/mcp-bigquery-server:latest"
notification_email          = "alerts@your-company.com"

bigquery_datasets = {
  analytics = {
    description                   = "Analytics data"
    location                      = "EU"
    delete_contents_on_destroy    = false
    default_table_expiration_ms   = 7776000000
    default_partition_expiration_ms = 0
  }
}

labels = {
  team        = "data"
  environment = "dev"
  managed_by  = "terraform"
}
EOF
```

## 🐳 Phase 3: Build and Push Container Image

### Step 3.1: Build MCP Server Image

```bash
# Navigate to project root
cd ../../..

# Build Docker image
docker build -t gcr.io/${PROJECT_ID}/mcp-bigquery-server:latest .

# Authenticate Docker with GCR
gcloud auth configure-docker

# Push image to Google Container Registry
docker push gcr.io/${PROJECT_ID}/mcp-bigquery-server:latest
```

## 🚀 Phase 4: Deploy Infrastructure with Terraform

### Step 4.1: Initialize Terraform

```bash
# Navigate to environment directory
cd terraform/environments/dev

# Initialize Terraform with backend configuration
terraform init -backend-config=backend.tfvars

# Expected output:
# Terraform has been successfully initialized!
```

### Step 4.2: Validate Configuration

```bash
# Format code
terraform fmt -recursive

# Validate syntax
terraform validate

# Expected output:
# Success! The configuration is valid.
```

### Step 4.3: Plan Deployment

```bash
# Create execution plan
terraform plan -out=tfplan

# Review the plan output carefully
# Expected resources to be created: ~50-70 resources
```

### Step 4.4: Apply Infrastructure

```bash
# Apply the plan
terraform apply tfplan

# This will take 5-10 minutes
# Terraform will create:
# - Workload Identity Pool and Providers
# - Service Accounts (NO KEYS!)
# - BigQuery Datasets with CMEK
# - Cloud Run Service
# - VPC and Networking
# - Monitoring and Logging
```

### Step 4.5: Capture Outputs

```bash
# Get authentication instructions
terraform output authentication_instructions

# Get service URL
terraform output cloud_run_service_url

# Get service account emails
terraform output mcp_service_account_email
terraform output bigquery_service_account_email

# Get Workload Identity Pool details
terraform output workload_identity_pool_name
terraform output google_workspace_provider_name
```

## ✅ Phase 5: Verify Deployment

### Step 5.1: Test Workload Identity Federation

```bash
# Get project number
PROJECT_NUMBER=$(gcloud projects describe ${PROJECT_ID} --format='value(projectNumber)')

# Test WIF pool
gcloud iam workload-identity-pools describe mcp-bigquery-pool-dev \
  --project=${PROJECT_ID} \
  --location=global

# Expected output: STATE: ACTIVE
```

### Step 5.2: Test BigQuery Access

```bash
# List datasets
bq ls --project_id=${PROJECT_ID}

# Expected output: List of datasets including analytics_dev
```

### Step 5.3: Test Cloud Run Service

```bash
# Get service URL
SERVICE_URL=$(terraform output -raw cloud_run_service_url)

# Test health endpoint
curl ${SERVICE_URL}/health

# Expected: {"status":"healthy","timestamp":"..."}
```

### Step 5.4: Test Google Workspace Authentication

```bash
# Generate OIDC token (use gcloud alpha)
gcloud alpha auth application-default login --scopes=openid,email,profile

# Test MCP server with WIF token
curl -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  ${SERVICE_URL}/mcp/tools/list_datasets
```

## 🔐 Phase 6: Configure Access Control

### Step 6.1: Grant User Access

```bash
# Grant specific users access to impersonate the service account
gcloud iam service-accounts add-iam-policy-binding \
  mcp-bigquery-server-dev@${PROJECT_ID}.iam.gserviceaccount.com \
  --member="user:alice@your-company.com" \
  --role="roles/iam.workloadIdentityUser" \
  --condition="None"
```

### Step 6.2: Grant Group Access

```bash
# Grant Google Workspace group access
gcloud iam service-accounts add-iam-policy-binding \
  mcp-bigquery-server-dev@${PROJECT_ID}.iam.gserviceaccount.com \
  --member="group:data-engineers@your-company.com" \
  --role="roles/iam.workloadIdentityUser" \
  --condition="None"
```

## 📊 Phase 7: Monitoring and Logging

### Step 7.1: View Audit Logs

```bash
# View BigQuery audit logs
gcloud logging read \
  "resource.type=bigquery_resource" \
  --limit=50 \
  --project=${PROJECT_ID}
```

### Step 7.2: View Cloud Run Logs

```bash
# Stream Cloud Run logs
gcloud run services logs read mcp-bigquery-server-dev \
  --project=${PROJECT_ID} \
  --region=us-central1 \
  --follow
```

### Step 7.3: Access Monitoring Dashboard

1. Go to [Cloud Monitoring](https://console.cloud.google.com/monitoring)
2. Navigate to **Dashboards**
3. Select **MCP BigQuery Server - dev**
4. Review metrics:
   - Request latency
   - Error rates
   - BigQuery quota usage
   - WIF token exchanges

## 🔄 Phase 8: CI/CD Setup (GitHub Actions)

### Step 8.1: Configure GitHub Repository

```bash
# Get WIF provider name
PROVIDER_NAME=$(terraform output -raw github_provider_name)

# Get service account email
SA_EMAIL=$(terraform output -raw mcp_service_account_email)

# Add these as GitHub repository secrets:
# GCP_PROJECT_ID: ${PROJECT_ID}
# GCP_WIF_PROVIDER: ${PROVIDER_NAME}
# GCP_SA_EMAIL: ${SA_EMAIL}
```

### Step 8.2: Create GitHub Actions Workflow

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to GCP

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write # Required for OIDC

    steps:
      - uses: actions/checkout@v3

      - uses: google-github-actions/auth@v1
        with:
          workload_identity_provider: ${{ secrets.GCP_WIF_PROVIDER }}
          service_account: ${{ secrets.GCP_SA_EMAIL }}

      - name: Build and Deploy
        run: |
          gcloud builds submit --tag gcr.io/${{ secrets.GCP_PROJECT_ID }}/mcp-bigquery-server:${{ github.sha }}
          gcloud run deploy mcp-bigquery-server-dev \
            --image gcr.io/${{ secrets.GCP_PROJECT_ID }}/mcp-bigquery-server:${{ github.sha }} \
            --region us-central1
```

## 🎉 Success Checklist

- [ ] Google Workspace OAuth client created
- [ ] Terraform state backend configured
- [ ] All GCP APIs enabled
- [ ] Container image built and pushed
- [ ] Terraform infrastructure deployed
- [ ] Workload Identity Pool active
- [ ] Service accounts created (NO KEYS!)
- [ ] BigQuery datasets with CMEK encryption
- [ ] Cloud Run service running
- [ ] Health check passing
- [ ] Google Workspace authentication working
- [ ] Audit logging configured
- [ ] Monitoring dashboard active
- [ ] CI/CD pipeline configured (optional)

## 🆘 Troubleshooting

See the Troubleshooting section in [terraform/README.md](../terraform/README.md#-troubleshooting) for common issues and
solutions.

## 📚 Next Steps

1. **Configure Additional Users**: Grant access to more Google Workspace users/groups
2. **Set Up Production**: Deploy staging and production environments
3. **Enable Alerting**: Configure alert policies for critical metrics
4. **Documentation**: Document custom dataset schemas and queries
5. **Training**: Train team on MCP server usage and WIF authentication

---

**Deployment Time**: ~30-45 minutes **Estimated Cost**: $50-100/month (depending on usage)

Generated by Hive Mind Collective Intelligence System 🐝
