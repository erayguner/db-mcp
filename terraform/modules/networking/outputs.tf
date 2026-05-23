output "vpc_id" {
  description = "VPC network ID"
  value       = google_compute_network.mcp_vpc.id
}

output "vpc_name" {
  description = "VPC network name"
  value       = google_compute_network.mcp_vpc.name
}

output "network_self_link" {
  description = "VPC network self-link (for Direct VPC egress)"
  value       = google_compute_network.mcp_vpc.id
}

output "subnet_id" {
  description = "Primary subnet ID (for Direct VPC egress)"
  value       = google_compute_subnetwork.mcp_subnet.id
}

output "subnet_name" {
  description = "Primary subnet name"
  value       = google_compute_subnetwork.mcp_subnet.name
}

output "cloud_armor_policy_id" {
  description = "Cloud Armor security policy ID (null when disabled)"
  value       = var.enable_cloud_armor ? google_compute_security_policy.mcp_armor[0].id : null
}

output "cloud_armor_policy_name" {
  description = "Cloud Armor security policy name (null when disabled)"
  value       = var.enable_cloud_armor ? google_compute_security_policy.mcp_armor[0].name : null
}

output "service_perimeter_name" {
  description = "VPC Service Controls perimeter name (null when disabled)"
  value       = (var.enable_vpc_service_controls && var.access_policy_name != "") ? google_access_context_manager_service_perimeter.mcp_perimeter[0].name : null
}

output "nat_ips" {
  description = "Cloud NAT external IPs"
  value       = google_compute_router_nat.mcp_nat.nat_ips
}

output "psc_nat_subnet_id" {
  description = "PSC NAT subnet ID (null when PSC disabled)"
  value       = var.enable_private_service_connect ? google_compute_subnetwork.psc_nat[0].id : null
}

output "proxy_only_subnet_id" {
  description = "REGIONAL_MANAGED_PROXY subnet ID (null when PSC disabled)"
  value       = var.enable_private_service_connect ? google_compute_subnetwork.proxy_only[0].id : null
}
