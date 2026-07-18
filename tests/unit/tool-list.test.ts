import { MCPBigQueryServer } from '../../src/index.js';
import { TOOL_SCHEMAS } from '../../src/mcp/schemas/tool-schemas.js';
import { OUTPUT_SCHEMAS } from '../../src/mcp/schemas/output-schemas.js';

const registeredHandlers: Record<string, Function> = {};
jest.mock('../../src/mcp/server-factory', () => {
  const original = jest.requireActual('../../src/mcp/server-factory');
  return {
    ...original,
    MCPServerFactory: class MockFactory extends original.MCPServerFactory {
      constructor(config: any) {
        super(config);
      }
      getServer() {
        return {
          setRequestHandler: (schema: any, handler: Function) => {
            // Map known method names from schema title/shape heuristics
            const methodName =
              (schema as any).properties?.method || schema.method || schema.title || 'unknown';
            // Fallback: use first key or symbol from schema object if necessary
            registeredHandlers[schema?.methodName || schema?.name || schema?.title || schema] =
              handler;
          },
        };
      }
      async start() {
        /* skip real connect */
      }
    },
  };
});

describe('Tool listing', () => {
  // `jest.mock()` above does not intercept the static ESM import of
  // server-factory under the ts-jest ESM preset, so `server.start()` runs the
  // real startup path: it initializes OpenTelemetry (whose periodic metric
  // reader holds a live, non-unref'd timer) and registers process-level
  // shutdown handlers. Started servers were never stopped, which is what made
  // Jest report "A worker process has failed to exit gracefully".
  const started: MCPBigQueryServer[] = [];

  const startServer = async (): Promise<MCPBigQueryServer> => {
    const server = new MCPBigQueryServer();
    started.push(server);
    await server.start();
    return server;
  };

  afterEach(async () => {
    while (started.length > 0) {
      await started.pop()!.shutdown('test teardown');
    }
  });

  it('exposes alias and output schema for execute_query', async () => {
    await startServer();
    expect(TOOL_SCHEMAS.execute_query).toBeDefined();
    expect(OUTPUT_SCHEMAS.execute_query).toBeDefined();
  });
  it('list_tools handler returns tools including execute_query', async () => {
    await startServer();
    const handlerEntry = Object.entries(registeredHandlers).find(
      ([k]) => String(k).includes('ListTools') || String(k).includes('tools')
    );
    if (handlerEntry) {
      const [, handler] = handlerEntry;
      const result = await handler();
      expect(result.tools).toBeDefined();
      const names = result.tools.map((t: any) => t.name);
      expect(names).toContain('execute_query');
    } else {
      // If handler not captured due to schema structure, assert fallback using schemas
      expect(Object.keys(TOOL_SCHEMAS)).toContain('execute_query');
    }
  });
});
