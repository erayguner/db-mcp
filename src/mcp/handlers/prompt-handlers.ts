import { logger } from '../../utils/logger.js';

/**
 * MCP Prompt definition — a template that guides AI clients.
 */
export interface MCPPrompt {
  name: string;
  description: string;
  arguments?: Array<{
    name: string;
    description: string;
    required?: boolean;
  }>;
}

/**
 * A single message in a prompt result.
 */
export interface MCPPromptMessage {
  role: 'user' | 'assistant';
  content: { type: 'text'; text: string };
}

/**
 * Result returned when a prompt is resolved with arguments.
 */
export interface PromptResult {
  description: string;
  messages: MCPPromptMessage[];
}

type PromptGenerator = (args: Record<string, string>) => PromptResult;

/**
 * Registry of built-in BigQuery MCP prompts.
 *
 * Each prompt produces a sequence of messages that instruct the AI client
 * to use the available MCP tools (list_tables, get_table_schema, query_bigquery)
 * in a structured way.
 */
export class PromptRegistry {
  private readonly prompts = new Map<
    string,
    { definition: MCPPrompt; generate: PromptGenerator }
  >();

  constructor() {
    this.registerBuiltins();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Return the list of all registered prompt definitions. */
  listPrompts(): MCPPrompt[] {
    return Array.from(this.prompts.values()).map((p) => p.definition);
  }

  /**
   * Resolve a prompt by name with the supplied arguments.
   *
   * @throws Error if the prompt is not found or required arguments are missing.
   */
  getPrompt(name: string, args: Record<string, string>): PromptResult {
    const entry = this.prompts.get(name);
    if (!entry) {
      logger.warn('Prompt not found', { name });
      throw new Error(`Unknown prompt: ${name}`);
    }

    // Validate required arguments
    const missing = (entry.definition.arguments ?? [])
      .filter((a) => a.required && !args[a.name])
      .map((a) => a.name);

    if (missing.length > 0) {
      throw new Error(`Missing required arguments for prompt "${name}": ${missing.join(', ')}`);
    }

    logger.debug('Generating prompt', { name, args });
    return entry.generate(args);
  }

  // ---------------------------------------------------------------------------
  // Registration helpers
  // ---------------------------------------------------------------------------

  private register(definition: MCPPrompt, generate: PromptGenerator): void {
    this.prompts.set(definition.name, { definition, generate });
  }

  // ---------------------------------------------------------------------------
  // Built-in prompts
  // ---------------------------------------------------------------------------

  private registerBuiltins(): void {
    this.registerAnalyzeTable();
    this.registerExploreDataset();
    this.registerWriteQuery();
    this.registerOptimizeQuery();
    this.registerDataQualityCheck();
  }

  private registerAnalyzeTable(): void {
    this.register(
      {
        name: 'analyze_table',
        description:
          'Analyze a BigQuery table by first inspecting its schema, then suggesting useful queries based on the column types and data.',
        arguments: [
          { name: 'datasetId', description: 'The BigQuery dataset ID', required: true },
          { name: 'tableId', description: 'The BigQuery table ID', required: true },
        ],
      },
      (args) => ({
        description: `Analyze the table ${args.datasetId}.${args.tableId}`,
        messages: [
          msg(
            'user',
            [
              `I want to understand the BigQuery table \`${args.datasetId}.${args.tableId}\`.`,
              '',
              'Please perform the following steps:',
              `1. Call the \`get_table_schema\` tool with datasetId="${args.datasetId}" and tableId="${args.tableId}" (include metadata).`,
              '2. Review the schema — column names, types, modes, and any descriptions.',
              '3. Summarize what this table appears to contain.',
              '4. Suggest 3-5 useful analytical queries a data analyst might run against this table, explaining what each one reveals.',
            ].join('\n')
          ),
          msg(
            'assistant',
            `I'll start by fetching the schema for \`${args.datasetId}.${args.tableId}\` using the get_table_schema tool.`
          ),
        ],
      })
    );
  }

  private registerExploreDataset(): void {
    this.register(
      {
        name: 'explore_dataset',
        description:
          'Explore a BigQuery dataset by listing all tables, examining their schemas, and providing a high-level summary.',
        arguments: [
          { name: 'datasetId', description: 'The BigQuery dataset ID to explore', required: true },
        ],
      },
      (args) => ({
        description: `Explore the dataset ${args.datasetId}`,
        messages: [
          msg(
            'user',
            [
              `I'd like to explore the BigQuery dataset \`${args.datasetId}\`.`,
              '',
              'Please perform the following steps:',
              `1. Call \`list_tables\` with datasetId="${args.datasetId}" to see all tables/views in this dataset.`,
              '2. For each table (or at least the first 10), call `get_table_schema` to examine the schema.',
              '3. Provide a summary of the dataset:',
              '   - How many tables/views are there?',
              '   - What are the key entities or domains represented?',
              '   - How do the tables relate to each other (any obvious foreign keys)?',
              '   - What kinds of analyses could be performed with this data?',
            ].join('\n')
          ),
          msg(
            'assistant',
            `I'll start by listing all tables in the \`${args.datasetId}\` dataset.`
          ),
        ],
      })
    );
  }

  private registerWriteQuery(): void {
    this.register(
      {
        name: 'write_query',
        description:
          'Translate a natural-language description into a BigQuery SQL query, first examining available tables and schemas.',
        arguments: [
          {
            name: 'description',
            description: 'Natural language description of what the query should do',
            required: true,
          },
          {
            name: 'datasetId',
            description: 'Optional dataset to scope the query to',
            required: false,
          },
        ],
      },
      (args) => {
        const datasetClause = args.datasetId
          ? `Focus on the dataset \`${args.datasetId}\`.`
          : 'Start by calling `list_datasets` to discover available datasets.';

        return {
          description: `Write a BigQuery SQL query: ${args.description}`,
          messages: [
            msg(
              'user',
              [
                `I need a BigQuery SQL query that does the following:`,
                `"${args.description}"`,
                '',
                'Please follow these steps:',
                `1. ${datasetClause}`,
                '2. Call `list_tables` to find relevant tables.',
                '3. Call `get_table_schema` on the most relevant tables to understand their columns.',
                '4. Write a well-formatted BigQuery Standard SQL query that fulfills the request.',
                '5. Explain what the query does and any assumptions you made.',
                '6. Optionally run a `dryRun` via `query_bigquery` to estimate bytes processed.',
              ].join('\n')
            ),
            msg(
              'assistant',
              "I'll start by examining the available tables and schemas so I can write an accurate query."
            ),
          ],
        };
      }
    );
  }

  private registerOptimizeQuery(): void {
    this.register(
      {
        name: 'optimize_query',
        description:
          'Analyze a BigQuery SQL query for cost and performance, then suggest concrete improvements.',
        arguments: [
          { name: 'query', description: 'The BigQuery SQL query to optimize', required: true },
        ],
      },
      (args) => ({
        description: 'Optimize a BigQuery SQL query for cost and performance',
        messages: [
          msg(
            'user',
            [
              'Please analyze the following BigQuery SQL query for cost and performance:',
              '',
              '```sql',
              args.query,
              '```',
              '',
              'Steps:',
              '1. Run a `dryRun` via `query_bigquery` to see the estimated bytes processed.',
              '2. Identify any tables referenced and call `get_table_schema` to check partitioning and clustering columns.',
              '3. Analyze the query for common BigQuery anti-patterns:',
              '   - SELECT * instead of specific columns',
              '   - Missing partition filters',
              '   - Cross joins or cartesian products',
              '   - Unnecessary subqueries that could be CTEs',
              '   - Functions that prevent partition pruning',
              '   - Inefficient JOIN ordering',
              '4. Provide an optimized version of the query with explanations for each change.',
              '5. Estimate the cost reduction if possible (run another dryRun on the optimized query).',
            ].join('\n')
          ),
          msg(
            'assistant',
            "I'll start by running a dry run on the original query to establish a baseline for bytes processed."
          ),
        ],
      })
    );
  }

  private registerDataQualityCheck(): void {
    this.register(
      {
        name: 'data_quality_check',
        description:
          'Check a BigQuery table for data quality issues including nulls, duplicates, and distribution anomalies.',
        arguments: [
          { name: 'datasetId', description: 'The BigQuery dataset ID', required: true },
          { name: 'tableId', description: 'The BigQuery table ID', required: true },
        ],
      },
      (args) => ({
        description: `Data quality check for ${args.datasetId}.${args.tableId}`,
        messages: [
          msg(
            'user',
            [
              `Please perform a data quality check on the BigQuery table \`${args.datasetId}.${args.tableId}\`.`,
              '',
              'Steps:',
              `1. Call \`get_table_schema\` with datasetId="${args.datasetId}" and tableId="${args.tableId}" (include metadata) to understand the schema.`,
              '2. For each column, generate and run queries via `query_bigquery` to check:',
              '   - **Null/missing values**: count of NULLs and percentage of total rows.',
              '   - **Duplicates**: identify columns or column combinations that should be unique and check for duplicates.',
              '   - **Distribution anomalies**: for numeric columns, check min/max/avg/stddev; for string columns, check distinct count and top values; for date columns, check range and gaps.',
              '3. Summarize findings in a data quality report:',
              '   - Overall row count',
              '   - Columns with high null rates (>5%)',
              '   - Potential duplicate rows',
              '   - Any outliers or unexpected distributions',
              '   - Recommendations for data cleaning or validation rules',
            ].join('\n')
          ),
          msg(
            'assistant',
            `I'll begin by fetching the schema for \`${args.datasetId}.${args.tableId}\` to understand the table structure before running quality checks.`
          ),
        ],
      })
    );
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function msg(role: 'user' | 'assistant', text: string): MCPPromptMessage {
  return { role, content: { type: 'text', text } };
}
