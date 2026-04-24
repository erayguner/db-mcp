import { zodToJsonSchema } from 'zod-to-json-schema';
import { z } from 'zod';
import { TOOL_SCHEMAS } from '../schemas/tool-schemas.js';
import { OUTPUT_SCHEMAS } from '../schemas/output-schemas.js';
import { getToolAnnotations, ToolAnnotations } from './annotations.js';

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: unknown; // JSON Schema
  outputSchema?: unknown; // JSON Schema
  annotations?: ToolAnnotations;
}

/**
 * Generate tool definitions combining input and output schemas.
 */
export function generateToolDefinitions(
  getDescription: (name: string) => string
): ToolDefinition[] {
  const entries = Object.entries(TOOL_SCHEMAS);

  return entries.map(([name, schema]) => {
    const inputSchema = zodToJsonSchema(schema as z.ZodType, { target: 'jsonSchema7' });
    const outputZod = OUTPUT_SCHEMAS[name as keyof typeof OUTPUT_SCHEMAS] as z.ZodType | undefined;
    const outputSchema = outputZod
      ? zodToJsonSchema(outputZod, { target: 'jsonSchema7' })
      : undefined;
    const description = getDescription(name);
    return {
      name,
      title: description,
      description,
      inputSchema,
      outputSchema,
      annotations: getToolAnnotations(name),
    };
  });
}
