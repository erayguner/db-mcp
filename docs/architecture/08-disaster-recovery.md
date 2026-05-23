# Disaster Recovery

## Overview

This document describes the disaster recovery (DR) posture for the BigQuery MCP Server. The system is split into two
tiers with different durability characteristics:

- **Stateless compute tier** (Cloud Run): can be restored in minutes via automated failover
- **Data tier** (BigQuery): inherits Google's managed durability for the `EU` multi-region

## RTO and RPO Targets

| Tier                 | RTO           | RPO | Mechanism                                 |
| -------------------- | ------------- | --- | ----------------------------------------- |
| Compute (Cloud Run)  | ~minutes      | ~0  | Global external ALB health-based failover |
| Data (BigQuery `EU`) | n/a (managed) | ~0  | Google-managed multi-region replication   |
| Terraform state      | < 1 hour      | ~0  | Multi-region GCS state bucket             |

The compute tier is stateless: no in-flight transactions are committed to durable storage by the MCP server itself. A
client request that hits a failed region is retried transparently by the load balancer against a healthy region; no data
is lost from the perspective of the MCP server.

## Compute Failover: Multi-Region Cloud Run with Global ALB

For production deployments that require regional redundancy, the Cloud Run service can be deployed to a second region
and placed behind a **global external Application Load Balancer** (ALB).

```
                     ┌──────────────────────────────┐
  Clients ──────────►│  Global External ALB          │
                     │  (Cloud Load Balancing)        │
                     └──────────┬───────────────────-─┘
                                │  Health-based routing
                    ┌───────────┴───────────┐
                    │                       │
                    ▼                       ▼
         ┌─────────────────┐     ┌─────────────────┐
         │ Cloud Run        │     │ Cloud Run        │
         │ europe-west2     │     │ (second region)  │
         │ (primary)        │     │ (standby)        │
         └─────────────────┘     └─────────────────┘
```

The ALB performs HTTP health checks against the `/health` endpoint on each Cloud Run backend. When the primary region
fails to pass health checks, the ALB automatically routes all traffic to the standby region. Failover is transparent to
MCP clients.

**Current state**: The Terraform `modules/cloud-run` module deploys a single-region Cloud Run service. Multi-region
deployment and the global ALB are a **planned addition** to the Terraform configuration. The ALB resources
(`google_compute_global_forwarding_rule`, backend services, and NEGs) shown above are not yet provisioned by default.

## Terraform State Durability

Terraform state is stored in a GCS bucket defined in `terraform/backend.tf`. For DR, the state bucket is configured with
multi-region storage (`MULTI_REGIONAL` storage class or a dual-region bucket in `EUR4`), ensuring state is not lost if a
single GCS region becomes unavailable.

Object versioning is enabled on the state bucket so that accidental state corruption can be recovered from a recent
version.

## BigQuery Data Durability

All BigQuery datasets are created in the `EU` multi-region location (configured via the `bigquery_location` Terraform
variable, default `EU`). The `EU` multi-region stores data redundantly across at least two geographically separated
Google data centres within the EU. Google manages replication automatically; no operator action is required for regional
failures within the multi-region.

**RPO is effectively zero** for the data tier under a single-region failure within the EU multi-region: data is
synchronously replicated before a write is acknowledged.

### Potential future state: BigQuery Managed Disaster Recovery

BigQuery Managed Disaster Recovery (BMDR) provides point-in-time recovery and controlled cross-region failover. It
requires:

- Datasets in a **single-region** location (incompatible with `EU` multi-region)
- BigQuery **Enterprise Plus** reservation

Enabling BMDR would require migrating datasets from the `EU` multi-region to a specific single region (e.g.,
`europe-west2`), which is a breaking change. This is tracked as a future option for environments that require a defined
RTO/RPO for the data tier beyond Google's default multi-region durability guarantees.

## Audit Log Retention and Recovery

Audit logs are retained for 2555 days (approximately 7 years) via a Cloud Logging log bucket with a linked BigQuery
dataset. The GCS-backed log bucket provides Google-managed durability. Logs in the linked BigQuery dataset inherit
BigQuery `EU` multi-region durability.

## Backup and Recovery Procedures

| Resource                | Backup mechanism                    | Recovery procedure                              |
| ----------------------- | ----------------------------------- | ----------------------------------------------- |
| Cloud Run configuration | Terraform state + source            | Re-run `terraform apply`                        |
| Container images        | Artifact Registry (`europe-west2`)  | Rebuild from source or re-tag existing image    |
| BigQuery datasets       | `EU` multi-region durability        | No manual restore required for regional failure |
| Terraform state         | Versioned GCS bucket                | Restore previous GCS object version             |
| Tenant config           | Secret Manager (`auto` replication) | Secret Manager managed                          |

## Runbook: Regional Compute Failure

1. Confirm Cloud Run in primary region is unhealthy via Cloud Monitoring or the ALB health dashboard.
2. If the global ALB is in place, traffic fails over automatically — verify the standby region is serving requests and
   error rates are acceptable.
3. If the global ALB is not yet deployed, update DNS or client configuration to point to the standby region Cloud Run
   URL.
4. Investigate root cause in Cloud Logging and Cloud Run console.
5. Once the primary region recovers, shift traffic back and verify parity before decommissioning the standby routing.
