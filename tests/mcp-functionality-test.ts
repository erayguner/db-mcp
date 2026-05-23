/**
 * MCP Server Functionality Test
 * Tests the bigquery-dev MCP server tools and resources
 */

import { spawn } from 'child_process';
import { Readable, Writable } from 'stream';

interface MCPRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: any;
}

interface MCPResponse {
  jsonrpc: '2.0';
  id: number;
  result?: any;
  error?: {
    code: number;
    message: string;
  };
}

class MCPTester {
  private mcpProcess: any;
  private requestId = 1;
  private responseBuffer = '';
  private pendingRequests = new Map<number, { resolve: Function; reject: Function }>();

  async start() {
    console.log('🚀 Starting BigQuery MCP Server...\n');

    this.mcpProcess = spawn('node', ['dist/index.js'], {
      env: {
        ...process.env,
        NODE_ENV: 'development',
        USE_MOCK_BIGQUERY: 'true',
        LOG_LEVEL: 'debug',
        GCP_PROJECT_ID: 'mock-project',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.mcpProcess.stdout.on('data', (data: Buffer) => {
      this.handleOutput(data.toString());
    });

    this.mcpProcess.stderr.on('data', (data: Buffer) => {
      console.error('MCP Error:', data.toString());
    });

    // Wait for initialization
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  private handleOutput(output: string) {
    this.responseBuffer += output;
    const lines = this.responseBuffer.split('\n');

    // Keep the last incomplete line in the buffer
    this.responseBuffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim()) {
        try {
          const response: MCPResponse = JSON.parse(line);
          const pending = this.pendingRequests.get(response.id);
          if (pending) {
            this.pendingRequests.delete(response.id);
            if (response.error) {
              pending.reject(new Error(response.error.message));
            } else {
              pending.resolve(response.result);
            }
          }
        } catch (e) {
          // Not JSON, probably a log line
          console.log('MCP Log:', line);
        }
      }
    }
  }

  async sendRequest(method: string, params?: any): Promise<any> {
    const id = this.requestId++;
    const request: MCPRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.mcpProcess.stdin.write(JSON.stringify(request) + '\n');

      // Timeout after 10 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout for ${method}`));
        }
      }, 10000);
    });
  }

  async testInitialize() {
    console.log('📋 Test 1: Initialize MCP Server');
    try {
      const result = await this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {
          roots: { listChanged: true },
          sampling: {},
        },
        clientInfo: {
          name: 'test-client',
          version: '1.0.0',
        },
      });
      console.log('✅ Initialize successful');
      console.log('   Server capabilities:', JSON.stringify(result.capabilities, null, 2));
      return result;
    } catch (error) {
      console.error('❌ Initialize failed:', error);
      throw error;
    }
  }

  async testListTools() {
    console.log('\n📋 Test 2: List Available Tools');
    try {
      const result = await this.sendRequest('tools/list');
      console.log('✅ Tools list successful');
      console.log(`   Found ${result.tools?.length || 0} tools:`);
      result.tools?.forEach((tool: any) => {
        console.log(`   - ${tool.name}: ${tool.description}`);
      });
      return result;
    } catch (error) {
      console.error('❌ List tools failed:', error);
      throw error;
    }
  }

  async testListResources() {
    console.log('\n📋 Test 3: List Available Resources');
    try {
      const result = await this.sendRequest('resources/list');
      console.log('✅ Resources list successful');
      console.log(`   Found ${result.resources?.length || 0} resources:`);
      result.resources?.forEach((resource: any) => {
        console.log(`   - ${resource.name}: ${resource.description}`);
      });
      return result;
    } catch (error) {
      console.error('❌ List resources failed:', error);
      throw error;
    }
  }

  async testQueryExecution() {
    console.log('\n📋 Test 4: Execute BigQuery Query');
    try {
      const result = await this.sendRequest('tools/call', {
        name: 'execute_query',
        arguments: {
          query: 'SELECT 1 as test_column',
          projectId: 'mock-project',
        },
      });
      console.log('✅ Query execution successful');
      console.log('   Result:', JSON.stringify(result, null, 2));
      return result;
    } catch (error) {
      console.error('❌ Query execution failed:', error);
      throw error;
    }
  }

  async stop() {
    console.log('\n🛑 Stopping MCP Server...');
    this.mcpProcess.kill();
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function runTests() {
  const tester = new MCPTester();

  try {
    await tester.start();
    await tester.testInitialize();
    await tester.testListTools();
    await tester.testListResources();
    await tester.testQueryExecution();

    console.log('\n✅ All tests passed!');
    console.log('\n📊 Summary:');
    console.log('   - MCP server is functioning correctly');
    console.log('   - Tools are accessible');
    console.log('   - Resources are available');
    console.log('   - Query execution works in mock mode');
  } catch (error) {
    console.error('\n❌ Test suite failed:', error);
    process.exit(1);
  } finally {
    await tester.stop();
  }
}

// Run tests
runTests().catch(console.error);
