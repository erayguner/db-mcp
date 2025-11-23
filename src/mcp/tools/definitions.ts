import { zodToJsonSchema } from 'zod-to-json-schema';
import { z } from 'zod';
import { TOOL_SCHEMAS } from '../schemas/tool-schemas.js';
import { OUTPUT_SCHEMAS } from '../schemas/output-schemas.js';

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: unknown; // JSON Schema
  outputSchema?: unknown; // JSON Schema
}

/**
 * Generate tool definitions combining input and output schemas.
 */
export function generateToolDefinitions(getDescription: (name: string) => string): ToolDefinition[] {
  const entries = Object.entries(TOOL_SCHEMAS) as [string, z.ZodTypeAny][];

  return entries.map(([name, schema]) => {
    // Cast to ZodTypeAny to avoid excessive instantiation depth from complex schemas
    // TypeScript can flag these conversions as overly deep; ignore to allow runtime conversion
    // @ts-ignore: allow complex Zod schema conversion
    const inputSchema = zodToJsonSchema(schema as z.ZodTypeAny, { target: 'jsonSchema7' });
    const outputZod = OUTPUT_SCHEMAS[name as keyof typeof OUTPUT_SCHEMAS] as z.ZodTypeAny | undefined;
    // @ts-ignore: allow complex Zod schema conversion
    const outputSchema = outputZod
      ? zodToJsonSchema(outputZod as z.ZodTypeAny, { target: 'jsonSchema7' })
      : undefined;
    const description = getDescription(name);
    return {
      name,
      title: description,
      description,
      inputSchema,
      outputSchema,
    };
  });
}
