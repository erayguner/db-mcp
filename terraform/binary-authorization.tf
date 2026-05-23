/**
 * Binary Authorization — image signature enforcement on Cloud Run.
 *
 * Architecture:
 *   1. Cloud KMS asymmetric signing key (ECDSA P-256) at
 *      projects/<P>/locations/<R>/keyRings/binauth/cryptoKeys/cosign.
 *      CI uses this key to cosign-sign images (see deploy.yml).
 *   2. A BinAuth attestor that verifies cosign signatures by the same key.
 *   3. A BinAuth policy whose default admission rule requires the attestor
 *      for Cloud Run deployments.
 *
 * Activate by setting var.enable_binary_authorization = true AND
 * mirroring that into the cloud_run module input
 * (var.enable_binary_authorization on the cloud-run service).
 *
 * Until activated, the resources here are still created so the KMS key
 * and attestor exist and CI can begin producing signed images now;
 * enforcement is gated by the Cloud Run service's binary_authorization
 * block.
 */

# --- KMS for cosign signing ---
resource "google_kms_key_ring" "binauth" {
  project  = var.project_id
  name     = "binauth"
  location = var.region

  depends_on = [google_project_service.required_apis]
}

resource "google_kms_crypto_key" "cosign" {
  name     = "cosign"
  key_ring = google_kms_key_ring.binauth.id
  purpose  = "ASYMMETRIC_SIGN"

  version_template {
    algorithm        = "EC_SIGN_P256_SHA256"
    protection_level = "SOFTWARE"
  }

  # Cosign needs a stable key for signature verification.
  lifecycle {
    prevent_destroy = true
  }
}

# CI signs images using this key (cosign sign --key gcpkms://...).
resource "google_kms_crypto_key_iam_member" "cosign_signer" {
  crypto_key_id = google_kms_crypto_key.cosign.id
  role          = "roles/cloudkms.signer"
  member        = "serviceAccount:${module.iam.mcp_service_account_email}"
}

# Verifiers need to read the public key.
resource "google_kms_crypto_key_iam_member" "cosign_verifier" {
  crypto_key_id = google_kms_crypto_key.cosign.id
  role          = "roles/cloudkms.publicKeyViewer"
  member        = "serviceAccount:${module.iam.mcp_service_account_email}"
}

# --- BinAuth attestor + policy ---
# Container Analysis note that the attestor attaches attestations to.
resource "google_container_analysis_note" "cosign" {
  project = var.project_id
  name    = "mcp-bigquery-cosign"

  attestation_authority {
    hint {
      human_readable_name = "MCP BigQuery cosign attestor"
    }
  }
}

# Attestor verifying cosign signatures from the KMS key above.
resource "google_binary_authorization_attestor" "cosign" {
  project = var.project_id
  name    = "mcp-bigquery-cosign-attestor"

  description = "Verifies cosign signatures by the binauth/cosign KMS key"

  attestation_authority_note {
    note_reference = google_container_analysis_note.cosign.name

    public_keys {
      id = google_kms_crypto_key.cosign.id

      pkix_public_key {
        public_key_pem      = data.google_kms_crypto_key_version.cosign_latest.public_key[0].pem
        signature_algorithm = "ECDSA_P256_SHA256"
      }
    }
  }
}

# Read the public half of the latest cosign key version.
data "google_kms_crypto_key_version" "cosign_latest" {
  crypto_key = google_kms_crypto_key.cosign.id
}

# Project Binary Authorization policy.
resource "google_binary_authorization_policy" "policy" {
  count   = var.enable_binary_authorization ? 1 : 0
  project = var.project_id

  # Allow Google-distributed images (managed services rely on them).
  global_policy_evaluation_mode = "ENABLE"

  admission_whitelist_patterns {
    name_pattern = "gcr.io/google_containers/*"
  }
  admission_whitelist_patterns {
    name_pattern = "gcr.io/google-containers/*"
  }
  admission_whitelist_patterns {
    name_pattern = "k8s.gcr.io/**"
  }
  admission_whitelist_patterns {
    name_pattern = "registry.k8s.io/**"
  }
  admission_whitelist_patterns {
    name_pattern = "gke.gcr.io/**"
  }

  # Default rule for Cloud Run: require the cosign attestor.
  default_admission_rule {
    evaluation_mode  = "REQUIRE_ATTESTATION"
    enforcement_mode = "ENFORCED_BLOCK_AND_AUDIT_LOG"
    require_attestations_by = [
      google_binary_authorization_attestor.cosign.name,
    ]
  }
}
