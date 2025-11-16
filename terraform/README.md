# GCP BigQuery MCP Server - Terraform Infrastructure

Complete Terraform infrastructure for deploying a GCP BigQuery MCP Server with **Workload Identity Federation** authentication.

## 🔐 Key Features

- **Zero Service Account Keys**: All authentication via Workload Identity Federation
- **Google Workspace Integration**: OIDC-based user authentication
- **GitHub Actions CI/CD**: Automated deployments with OIDC
- **Customer-Managed Encryption**: CMEK for BigQuery datasets
- **Comprehensive Audit Logging**: 7-year retention for compliance
- **VPC Service Controls**: Data exfiltration prevention
- **Multi-Environment Support**: Dev, Staging, Production

## 📁 Project Structure

```
terraform/
├── main.tf                    # Root module configuration
├── variables.tf               # Input variables
├── outputs.tf                 # Output values
├── versions.tf                # Terraform and provider versions
├── backend.tf                 # Remote state configuration
├── modules/
│   ├── workload-identity-federation/  # WIF configuration
│   ├── iam/                           # Service accounts and permissions
│   ├── bigquery/                      # Datasets and encryption
│   ├── cloud-run/                     # MCP server deployment
│   ├── networking/                    # VPC and security
│   └── monitoring/                    # Logging and alerting
└── environments/
    ├── dev/                   # Development configuration
    ├── staging/               # Staging configuration
    └── prod/                  # Production configuration
```

## 🚀 Quick Start

### Prerequisites

1. **GCP Project**: Create a GCP project
2. **Terraform**: Install Terraform >= 1.5.0
3. **gcloud CLI**: Install and authenticate
4. **Google Workspace**: Set up OAuth2 client for OIDC
5. **Permissions**: Project Owner or equivalent

### Step 1: Google Workspace OIDC Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Navigate to **APIs & Services** > **Credentials**
3. Create **OAuth 2.0 Client ID**:
   - Application type: Web application
   - Authorized redirect URIs: `https://console.cloud.google.com/`
4. Note the **Client ID** (you'll need this)
5. Configure OAuth consent screen with your Workspace domain

### Step 2: Initialize Backend

```bash
# Create GCS bucket for Terraform state
gsutil mb -p YOUR_PROJECT_ID -l us-central1 gs://YOUR_PROJECT_ID-terraform-state

# Enable versioning
gsutil versioning set on gs://YOUR_PROJECT_ID-terraform-state
```

### Step 3: Configure Environment

```bash
cd terraform/environments/dev

# Copy example configuration
cp terraform.tfvars.example terraform.tfvars

# Edit configuration
vim terraform.tfvars
```

Example `terraform.tfvars`:

```hcl
project_id                  = "your-gcp-project-id"
region                      = "us-central1"
environment                 = "dev"
google_workspace_domain     = "your-company.com"
google_workspace_client_id  = "123456789-abc.apps.googleusercontent.com"
github_repo                 = "your-org/your-repo"
cloud_run_container_image   = "gcr.io/your-project/mcp-bigquery-server:latest"
notification_email          = "alerts@your-company.com"

bigquery_datasets = {
  analytics = {
    description                   = "Analytics data"
    location                      = "US"
    delete_contents_on_destroy    = false
    default_table_expiration_ms   = 7776000000  # 90 days
    default_partition_expiration_ms = 0
  }
  warehouse = {
    description                   = "Data warehouse"
    location                      = "US"
    delete_contents_on_destroy    = false
    default_table_expiration_ms   = 0
    default_partition_expiration_ms = 0
  }
}

labels = {
  team        = "data"
  cost_center = "engineering"
}
```

### Step 4: Deploy Infrastructure

```bash
# Initialize Terraform
terraform init -backend-config=backend.tfvars

# Validate configuration
terraform validate

# Plan deployment
terraform plan -out=tfplan

# Apply (requires confirmation)
terraform apply tfplan
```

### Step 5: Configure Authentication

After deployment, Terraform will output authentication instructions:

```bash
terraform output authentication_instructions
```

## 🔐 Workload Identity Federation

### Architecture

```
Google Workspace User
  ↓ (OIDC Token)
Identity Pool
  ↓ (Attribute Mapping)
Service Account Impersonation
  ↓ (1-hour token)
BigQuery API Access
```

### For Google Workspace Users

1. Navigate to Workload Identity Pool in GCP Console
2. Select the created pool
3. Authenticate with your Workspace account
4. MCP server will use your identity to access BigQuery

### For GitHub Actions

Add to your workflow:

```yaml
- uses: google-github-actions/auth@v1
  with:
    workload_identity_provider: 'projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL_ID/providers/github-actions-dev'
    service_account: 'mcp-bigquery-server-dev@PROJECT_ID.iam.gserviceaccount.com'
```

### For Cloud Run (Automatic)

Cloud Run service is automatically configured with Workload Identity. No manual configuration needed.

## 📊 Module Documentation

### Workload Identity Federation Module

Creates identity pools and OIDC providers for external authentication.

**Resources Created**:
- Workload Identity Pool
- Google Workspace OIDC Provider
- GitHub Actions OIDC Provider
- Generic OIDC Provider (disabled by default)

**Attribute Mapping**:
- Maps external token claims to GCP IAM conditions
- Enforces domain restrictions
- Validates email verification

### IAM Module

Manages service accounts and permissions using Workload Identity.

**Resources Created**:
- MCP Server service account (NO KEYS)
- BigQuery access service account (NO KEYS)
- Service account impersonation bindings
- Workload Identity User permissions
- Custom IAM roles

**Security**:
- Zero service account keys stored
- Principle of least privilege
- Time-limited tokens (1 hour)
- Comprehensive audit trail

### BigQuery Module

Creates datasets with encryption and access controls.

**Resources Created**:
- KMS key ring and crypto keys
- BigQuery datasets with CMEK
- Audit logging configuration
- Log sinks to BigQuery
- Audit logs dataset (7-year retention)

**Security**:
- Customer-Managed Encryption Keys (CMEK)
- Automatic key rotation (90 days)
- Row-level security support
- Comprehensive audit logging

### Cloud Run Module

Deploys MCP server with Workload Identity.

**Resources Created**:
- Cloud Run service
- Load balancer
- SSL certificates
- IAM permissions
- Scaling configuration

**Features**:
- Automatic Workload Identity configuration
- VPC connector integration
- Health checks
- Autoscaling (1-10 instances)

### Networking Module

Creates VPC and security controls.

**Resources Created**:
- VPC network and subnets
- VPC connector for Cloud Run
- Firewall rules
- VPC Service Controls perimeter
- Private Service Connect

**Security**:
- Private IP ranges
- Egress controls
- Data exfiltration prevention
- Network isolation

### Monitoring Module

Sets up logging and alerting.

**Resources Created**:
- Cloud Monitoring dashboards
- Log sinks
- Alert policies
- Uptime checks
- SLO monitoring

**Metrics**:
- Request latency
- Error rates
- BigQuery quota usage
- Workload Identity token exchanges

## 🧪 Testing

```bash
# Validate Terraform syntax
terraform fmt -check -recursive
terraform validate

# Check for security issues
checkov -d .

# Test WIF authentication
gcloud iam workload-identity-pools describe POOL_ID \
  --project=PROJECT_ID \
  --location=global
```

## 🔧 Troubleshooting

### WIF Authentication Fails

```bash
# Check identity pool status
gcloud iam workload-identity-pools describe POOL_ID \
  --project=PROJECT_ID \
  --location=global

# Verify provider configuration
gcloud iam workload-identity-pools providers describe PROVIDER_ID \
  --workload-identity-pool=POOL_ID \
  --project=PROJECT_ID \
  --location=global
```

### BigQuery Access Denied

```bash
# Check service account permissions
gcloud projects get-iam-policy PROJECT_ID \
  --flatten="bindings[].members" \
  --filter="bindings.members:serviceAccount:mcp-bigquery-server-dev@*"

# Test BigQuery access
bq ls --project_id=PROJECT_ID
```

### Cloud Run Service Not Starting

```bash
# Check logs
gcloud run services logs read mcp-bigquery-server-dev \
  --project=PROJECT_ID \
  --region=REGION

# Check service configuration
gcloud run services describe mcp-bigquery-server-dev \
  --project=PROJECT_ID \
  --region=REGION
```

## 📚 Additional Resources

- [Workload Identity Federation Docs](https://cloud.google.com/iam/docs/workload-identity-federation)
- [BigQuery Security Best Practices](https://cloud.google.com/bigquery/docs/best-practices-security)
- [Cloud Run Documentation](https://cloud.google.com/run/docs)
- [Terraform Google Provider](https://registry.terraform.io/providers/hashicorp/google/latest/docs)

## 🤝 Contributing

This infrastructure is managed by the Hive Mind collective intelligence system. All changes are coordinated through the swarm.

## 📄 License

See LICENSE file in repository root.

---

**Generated by Hive Mind Collective Intelligence System**
**Swarm ID**: swarm-1761478601264-u0124wi2m
