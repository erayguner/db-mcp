output "template_id" {
  description = "Model Armor template short ID"
  value       = google_model_armor_template.mcp.template_id
}

output "template_name" {
  description = "Model Armor template full resource name (projects/{p}/locations/{l}/templates/{t}) — pass to the app as MODEL_ARMOR_TEMPLATE."
  value       = google_model_armor_template.mcp.name
}

output "template_resource" {
  description = "Convenience: the full resource path the app expects in MODEL_ARMOR_TEMPLATE."
  value       = "projects/${var.project_id}/locations/${var.location}/templates/${google_model_armor_template.mcp.template_id}"
}

output "floor_setting_id" {
  description = "Model Armor floor setting ID (null when enable_floor_setting=false)."
  value       = var.enable_floor_setting ? google_model_armor_floorsetting.mcp[0].id : null
}
