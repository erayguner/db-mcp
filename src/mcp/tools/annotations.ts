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
  query_bigquery: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  execute_query: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  list_datasets: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  list_tables: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  get_table_schema: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

export function getToolAnnotations(toolName: string): ToolAnnotations {
  return TOOL_ANNOTATIONS[toolName] || readOnlyAnnotations();
}
