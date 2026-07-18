import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = path.join(__dirname, '../..');

/**
 * Spawns the real server over stdio and speaks MCP to it.
 *
 * This suite was disabled with a TODO blaming "stdio transport configuration /
 * server initialization sequence / MCP SDK version compatibility". None of those
 * were the cause. There were two concrete bugs:
 *
 *  1. It spawned `dist/index.js`, so it tested whatever was last built rather
 *     than the current source — the checked-in dist was a month stale. It now
 *     runs `src/index.ts` through tsx, so it always exercises HEAD.
 *  2. It set LOG_LEVEL=error and then waited for the string "Server started",
 *     which is logged at INFO. That line could never appear, so startup
 *     detection always fell through to a timer. Readiness is now determined by
 *     the server answering `initialize` — the only signal that actually proves
 *     the protocol is up.
 */
function spawnServer(): ChildProcessWithoutNullStreams {
  // src/index.ts only calls main() when NOT in a test environment:
  //   isTestEnv = NODE_ENV === 'test' || JEST_WORKER_ID !== undefined
  // The old version spread process.env (inheriting JEST_WORKER_ID from the Jest
  // runner) AND set NODE_ENV='test', so the spawned server silently exited
  // without ever starting — producing the unexplained timeout this suite was
  // disabled for. The child must therefore look like a production process.
  const childEnv = { ...process.env };
  delete childEnv.JEST_WORKER_ID;

  return spawn('npx', ['tsx', path.join(REPO_ROOT, 'src/index.ts')], {
    cwd: REPO_ROOT,
    env: {
      ...childEnv,
      NODE_ENV: 'production',
      MCP_TRANSPORT: 'stdio',
      LOG_LEVEL: 'error',
      GCP_PROJECT_ID: 'test-project-id',
      GCP_REGION: 'europe-west2',
      BIGQUERY_LOCATION: 'europe-west2',
      WORKLOAD_IDENTITY_POOL_ID: 'test-pool',
      WORKLOAD_IDENTITY_PROVIDER_ID: 'test-provider',
      MCP_SERVICE_ACCOUNT_EMAIL: 'test@test-project.iam.gserviceaccount.com',
      GOOGLE_WORKSPACE_CLIENT_ID: 'test-client-id',
      GOOGLE_WORKSPACE_DOMAIN: 'test.com',
      USE_MOCK_BIGQUERY: 'true',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function sendRequest(
  proc: ChildProcessWithoutNullStreams,
  method: string,
  params?: unknown,
  timeoutMs = 30_000
): Promise<Record<string, unknown>> {
  const id = Math.floor(Math.random() * 1e6);
  const payload = { jsonrpc: '2.0', id, method, params };

  return new Promise((resolve, reject) => {
    let buffer = '';
    let stderr = '';

    const onStderr = (d: Buffer) => {
      stderr += d.toString();
    };

    const cleanup = () => {
      proc.stdout.off('data', onData);
      proc.stderr.off('data', onStderr);
      clearTimeout(timer);
    };

    const onData = (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === id) {
            cleanup();
            if (msg.error) reject(new Error(msg.error.message));
            else resolve(msg.result);
          }
        } catch {
          /* server logs are not JSON-RPC; ignore */
        }
      }
    };

    const timer = setTimeout(() => {
      cleanup();
      // Surface stderr: a bare "timeout" gave no clue why this suite was broken.
      reject(new Error(`Timed out awaiting "${method}". Server stderr:\n${stderr}`));
    }, timeoutMs);

    proc.stdout.on('data', onData);
    proc.stderr.on('data', onStderr);
    proc.stdin.write(JSON.stringify(payload) + '\n');
  });
}

describe('Integration: MCP protocol over stdio', () => {
  let proc: ChildProcessWithoutNullStreams;

  beforeAll(async () => {
    proc = spawnServer();
    // A successful `initialize` response is the readiness signal.
    await sendRequest(proc, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'itest', version: '1.0.0' },
    });
  }, 60_000);

  afterAll(async () => {
    proc?.kill();
    await new Promise((r) => setTimeout(r, 200));
  });

  it('advertises every tool with a description and an outputSchema', async () => {
    const result = await sendRequest(proc, 'tools/list');
    const tools = result.tools as Array<Record<string, unknown>>;

    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);

    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.outputSchema).toBeDefined();
      expect(tool.annotations).toBeDefined();
    }
  }, 60_000);

  it('exposes the documented tool set', async () => {
    const result = await sendRequest(proc, 'tools/list');
    const names = (result.tools as Array<{ name: string }>).map((t) => t.name);

    expect(names).toContain('query_bigquery');
    expect(names).toContain('execute_query');
    expect(names).toContain('list_datasets');
    expect(names).toContain('list_tables');
    expect(names).toContain('get_table_schema');
  }, 60_000);

  it('gives execute_query a real description rather than a placeholder', async () => {
    const result = await sendRequest(proc, 'tools/list');
    const tool = (result.tools as Array<{ name: string; description: string }>).find(
      (t) => t.name === 'execute_query'
    );

    expect(tool).toBeDefined();
    // It previously fell through to the literal fallback string 'BigQuery tool',
    // leaving a model no basis to choose between it and query_bigquery.
    expect(tool!.description).not.toBe('BigQuery tool');
    expect(tool!.description.length).toBeGreaterThan(40);
  }, 60_000);

  it('serves resource templates and prompts', async () => {
    const templates = await sendRequest(proc, 'resources/templates/list');
    expect((templates.resourceTemplates as unknown[]).length).toBeGreaterThan(0);

    const prompts = await sendRequest(proc, 'prompts/list');
    expect((prompts.prompts as unknown[]).length).toBeGreaterThan(0);
  }, 60_000);

  it('emits notifications/progress when the client supplies a progressToken', async () => {
    // ProgressNotifier/ProgressTracker existed but were wired to nothing — no
    // progressToken was ever read from a request, so no progress notification
    // could ever be sent. This asserts the wiring, end to end over stdio.
    const notifications: Array<Record<string, unknown>> = [];
    let buffer = '';
    const collect = (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.method === 'notifications/progress') notifications.push(msg.params);
        } catch {
          /* not JSON-RPC */
        }
      }
    };
    proc.stdout.on('data', collect);

    try {
      // The call itself fails (no real BigQuery here); progress must still flow.
      await sendRequest(proc, 'tools/call', {
        name: 'list_datasets',
        arguments: {},
        _meta: { progressToken: 'tok-1' },
      }).catch(() => undefined);

      await new Promise((r) => setTimeout(r, 500));

      expect(notifications.length).toBeGreaterThan(0);
      expect(notifications.every((n) => n.progressToken === 'tok-1')).toBe(true);
      expect(notifications.some((n) => typeof n.message === 'string')).toBe(true);
    } finally {
      proc.stdout.off('data', collect);
    }
  }, 60_000);

  it('answers logging/setLevel, the capability it advertises', async () => {
    // The server advertises `logging` in its capabilities. Before this was
    // implemented, calling setLevel returned method-not-found.
    await expect(sendRequest(proc, 'logging/setLevel', { level: 'debug' })).resolves.toBeDefined();
  }, 60_000);
});
