export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export function readOnlyAnnotations(): ToolAnnotations {
  return {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
}

export function destructiveAnnotations(): ToolAnnotations {
  return {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  };
}

const TOOL_ANNOTATIONS: Record<string, ToolAnnotations> = {
  query_bigquery: { ...readOnlyAnnotations(), idempotentHint: false },
  execute_query: { ...readOnlyAnnotations(), idempotentHint: false },
  list_datasets: readOnlyAnnotations(),
  list_tables: readOnlyAnnotations(),
  get_table_schema: readOnlyAnnotations(),
};

export function getToolAnnotations(toolName: string): ToolAnnotations {
  return TOOL_ANNOTATIONS[toolName] || readOnlyAnnotations();
}
