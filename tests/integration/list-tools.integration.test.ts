import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function spawnServer(): Promise<{ proc: any; stop: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [path.join(__dirname, '../../dist/index.js')], {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        LOG_LEVEL: 'error',
        GCP_PROJECT_ID: 'test-project-id', // Required by environment validation
        USE_MOCK_BIGQUERY: 'true', // Use mock to avoid real GCP calls
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let started = false;
    proc.stderr.on('data', d => {
      const s = d.toString();
      if (!started && s.includes('Server started')) {
        started = true;
        resolve({ proc, stop: () => new Promise(r => { proc.kill(); setTimeout(r, 250); }) });
      }
    });
    setTimeout(() => { if (!started) resolve({ proc, stop: async () => { proc.kill(); } }); }, 1500);
    proc.on('error', reject);
  });
}

function sendRequest(proc: any, method: string, params?: any): Promise<any> {
  const id = Math.floor(Math.random()*1e6);
  const payload = { jsonrpc: '2.0', id, method, params };
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === id) {
            proc.stdout.off('data', onData);
            if (msg.error) reject(new Error(msg.error.message));
            else resolve(msg.result);
          }
        } catch { /* ignore non-json */ }
      }
    };
    proc.stdout.on('data', onData);
    proc.stdin.write(JSON.stringify(payload) + '\n');
    setTimeout(() => { reject(new Error('timeout')); }, 8000);
  });
}

describe('Integration: list_tools', () => {
  it('returns execute_query tool', async () => {
    const { proc, stop } = await spawnServer();
    try {
      // initialize
      await sendRequest(proc, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'itest', version: '1.0.0' }
      });
      const toolsResult = await sendRequest(proc, 'tools/list');
      expect(Array.isArray(toolsResult.tools)).toBe(true);
      const names = toolsResult.tools.map((t: any) => t.name);
      expect(names).toContain('execute_query');
      const exeTool = toolsResult.tools.find((t: any) => t.name === 'execute_query');
      expect(exeTool.outputSchema).toBeDefined();
    } finally {
      await stop();
    }
  });
});
