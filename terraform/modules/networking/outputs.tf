output "vpc_id" {
  description = "VPC network ID"
  value       = google_compute_network.mcp_vpc.id
}

output "vpc_name" {
  description = "VPC network name"
  value       = google_compute_network.mcp_vpc.name
}

output "subnet_id" {
  description = "Subnet ID"
  value       = google_compute_subnetwork.mcp_subnet.id
}

output "subnet_name" {
  description = "Subnet name"
  value       = google_compute_subnetwork.mcp_subnet.name
}

output "vpc_connector_id" {
  description = "VPC Access Connector ID"
  value       = google_vpc_access_connector.mcp_connector.id
}

output "vpc_connector_name" {
  description = "VPC Access Connector name"
  value       = google_vpc_access_connector.mcp_connector.name
}

output "cloud_armor_policy_id" {
  description = "Cloud Armor security policy ID"
  value       = var.enable_cloud_armor ? google_compute_security_policy.mcp_armor[0].id : null
}

output "cloud_armor_policy_name" {
  description = "Cloud Armor security policy name"
  value       = var.enable_cloud_armor ? google_compute_security_policy.mcp_armor[0].name : null
}

output "service_perimeter_name" {
  description = "VPC Service Controls perimeter name"
  value       = var.enable_vpc_service_controls ? google_access_context_manager_service_perimeter.mcp_perimeter[0].name : null
}

output "nat_ips" {
  description = "NAT external IPs"
  value       = google_compute_router_nat.mcp_nat.nat_ips
}

output "psc_nat_subnet_id" {
  description = "Subnet ID reserved for PSC NAT (null when disabled)"
  value       = var.enable_private_service_connect ? google_compute_subnetwork.psc_nat[0].id : null
}
