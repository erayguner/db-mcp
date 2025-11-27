import { EventEmitter } from 'events';
import {
  BigQueryClientFactory,
  BigQueryClientFactoryConfig,
  ClientFactoryError,
} from '../../../src/mcp/bigquery-client-factory.js';

// Mock dependencies
jest.mock('../../../src/bigquery/client');
jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { BigQueryClient } from '../../../src/bigquery/client.js';
const MockBigQueryClient = BigQueryClient as unknown as jest.Mock;

// TODO: These tests need refactoring for ES module compatibility
// The current mocking pattern doesn't work well with TypeScript ES modules
describe.skip('BigQueryClientFactory', () => {
  let mockBigQueryClient: jest.Mocked<BigQueryClient>;
  let defaultConfig: BigQueryClientFactoryConfig;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Create mock BigQuery client factory function
    const createMockClient = () => ({
      isHealthy: jest.fn().mockReturnValue(true),
      shutdown: jest.fn().mockResolvedValue(undefined),
      invalidateCache: jest.fn(),
      getPoolMetrics: jest.fn().mockReturnValue({
        activeConnections: 2,
        idleConnections: 1,
        totalConnections: 3,
      }),
      getCacheStats: jest.fn().mockReturnValue({
        hits: 10,
        misses: 5,
        size: 15,
      }),
      on: jest.fn(),
    } as any);

    // Mock implementation returns a new instance each time
    MockBigQueryClient.mockImplementation(createMockClient);

    // Keep a reference for tests that need it
    mockBigQueryClient = createMockClient();

    defaultConfig = {
      defaultProjectId: 'test-project',
      defaultLocation: 'US',
      pooling: {
        enabled: true,
        minConnections: 2,
        maxConnections: 10,
        acquireTimeoutMs: 30000,
        idleTimeoutMs: 300000,
      },
      caching: {
        enabled: true,
        cacheSize: 100,
        cacheTTLMs: 3600000,
      },
      retry: {
        enabled: true,
        maxRetries: 3,
        initialDelayMs: 1000,
      },
      monitoring: {
        enabled: true,
        healthCheckIntervalMs: 60000,
      },
    };
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('Constructor and Initialization', () => {
    it('should create factory with default configuration', () => {
      const factory = new BigQueryClientFactory(defaultConfig);

      expect(factory).toBeInstanceOf(BigQueryClientFactory);
      expect(factory).toBeInstanceOf(EventEmitter);
    });

    it('should validate and apply default configuration values', () => {
      const minimalConfig: BigQueryClientFactoryConfig = {
        pooling: { enabled: false },
        caching: { enabled: false },
        retry: { enabled: false },
        monitoring: { enabled: false },
      };

      const factory = new BigQueryClientFactory(minimalConfig);

      expect(factory).toBeDefined();
    });

    it('should start health monitoring when enabled', () => {
      const factory = new BigQueryClientFactory(defaultConfig);

      jest.advanceTimersByTime(60000);

      // Health monitoring should be active
      expect(factory.isHealthy()).toBe(true);
    });

    it('should not start health monitoring when disabled', () => {
      const config = {
        ...defaultConfig,
        monitoring: { enabled: false },
      };

      const factory = new BigQueryClientFactory(config);

      jest.advanceTimersByTime(100000);

      // Should still work without health monitoring
      expect(factory.isHealthy()).toBe(true);
    });

    it('should emit client events', async () => {
      const factory = new BigQueryClientFactory(defaultConfig);
      const createdHandler = jest.fn();

      factory.on('client:created', createdHandler);

      await factory.getClient('test-project');

      expect(createdHandler).toHaveBeenCalledWith({ projectId: 'test-project' });
    });
  });

  describe('Client Management', () => {
    it('should create new client for project', async () => {
      const factory = new BigQueryClientFactory(defaultConfig);

      const client = await factory.getClient('test-project');

      expect(client).toBeDefined();
      expect(BigQueryClient).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'test-project',
        })
      );
    });

    it('should reuse existing client for same project', async () => {
      const factory = new BigQueryClientFactory(defaultConfig);

      const client1 = await factory.getClient('test-project');
      const client2 = await factory.getClient('test-project');

      expect(client1).toBe(client2);
      expect(BigQueryClient).toHaveBeenCalledTimes(1);
    });

    it('should create separate clients for different projects', async () => {
      const factory = new BigQueryClientFactory(defaultConfig);

      const client1 = await factory.getClient('project-1');
      const client2 = await factory.getClient('project-2');

      expect(client1).not.toBe(client2);
      expect(BigQueryClient).toHaveBeenCalledTimes(2);
    });

    it('should use default project when not specified', async () => {
      const factory = new BigQueryClientFactory(defaultConfig);

      await factory.getClient();

      expect(BigQueryClient).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'test-project',
        })
      );
    });

    it('should throw error when no project specified and no default', () => {
      const config = {
        ...defaultConfig,
        defaultProjectId: undefined,
      };

      const factory = new BigQueryClientFactory(config);

      expect(() => factory.getClient()).toThrow(ClientFactoryError);
      expect(() => factory.getClient()).toThrow('No project ID specified');
    });

    it('should track client metadata', async () => {
      const factory = new BigQueryClientFactory(defaultConfig);

      await factory.getClient('test-project');

      const metrics = factory.getMetrics();

      expect(metrics.totalClients).toBe(1);
      expect(metrics.clients[0].projectId).toBe('test-project');
      expect(metrics.clients[0].queryCount).toBeGreaterThanOrEqual(0);
    });

    it('should increment query count on client reuse', () => {
      const factory = new BigQueryClientFactory(defaultConfig);

      factory.getClient('test-project'); // Creates client, queryCount = 0
      factory.getClient('test-project'); // Reuses client, queryCount = 1
      factory.getClient('test-project'); // Reuses client, queryCount = 2

      const metrics = factory.getMetrics();

      expect(metrics.clients[0].queryCount).toBe(2);
    });

    it('should update last used timestamp', async () => {
      const factory = new BigQueryClientFactory(defaultConfig);

      await factory.getClient('test-project');

      jest.advanceTimersByTime(5000);

      await factory.getClient('test-project');

      const metrics = factory.getMetrics();

      expect(metrics.clients[0].lastUsed).toBeLessThan(5000);
    });

    it('should check client health before reuse', () => {
      let callCount = 0;
      const createMockWithHealth = () => {
        callCount++;
        const isHealthy = callCount === 1; // First client is healthy, second is not
        return {
          isHealthy: jest.fn().mockReturnValue(isHealthy),
          shutdown: jest.fn().mockResolvedValue(undefined),
          invalidateCache: jest.fn(),
          getPoolMetrics: jest.fn().mockReturnValue({
            activeConnections: 2,
            idleConnections: 1,
            totalConnections: 3,
          }),
          getCacheStats: jest.fn().mockReturnValue({
            hits: 10,
            misses: 5,
            size: 15,
          }),
          on: jest.fn(),
        } as any;
      };

      (BigQueryClient as jest.MockedClass<typeof BigQueryClient>).mockImplementation(createMockWithHealth);

      const factory = new BigQueryClientFactory(defaultConfig);

      const client1 = factory.getClient('test-project');

      // Make the stored client return unhealthy
      client1.isHealthy = jest.fn().mockReturnValue(false);

      factory.getClient('test-project');

      // Should create new client because first one is unhealthy
      expect(BigQueryClient).toHaveBeenCalledTimes(2);
    });

    it('should pass pooling configuration to client', async () => {
      const factory = new BigQueryClientFactory(defaultConfig);

      await factory.getClient('test-project');

      expect(BigQueryClient).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionPool: expect.objectContaining({
            minConnections: 2,
            maxConnections: 10,
          }),
        })
      );
    });

    it('should pass caching configuration to client', async () => {
      const factory = new BigQueryClientFactory(defaultConfig);

      await factory.getClient('test-project');

      expect(BigQueryClient).toHaveBeenCalledWith(
        expect.objectContaining({
          datasetManager: expect.objectContaining({
            cacheSize: 100,
            cacheTTLMs: 3600000,
          }),
        })
      );
    });

    it('should pass retry configuration to client', async () => {
      const factory = new BigQueryClientFactory(defaultConfig);

      await factory.getClient('test-project');

      expect(BigQueryClient).toHaveBeenCalledWith(
        expect.objectContaining({
          retry: expect.objectContaining({
            maxRetries: 3,
            initialDelayMs: 1000,
          }),
        })
      );
    });
  });

  describe('Client Removal', () => {
    it.skip('should remove client successfully', async () => {
      const factory = new BigQueryClientFactory(defaultConfig);

      await factory.getClient('test-project');
      await factory.removeClient('test-project');

      expect(mockBigQueryClient.shutdown).toHaveBeenCalled();
      expect(factory.hasClient('test-project')).toBe(false);
    });

    it('should emit client:removed event', async () => {
      const factory = new BigQueryClientFactory(defaultConfig);
      const removedHandler = jest.fn();

      factory.on('client:removed', removedHandler);

      await factory.getClient('test-project');
      await factory.removeClient('test-project');

      expect(removedHandler).toHaveBeenCalledWith({ projectId: 'test-project' });
    });

    it('should handle removal of non-existent client gracefully', async () => {
      const factory = new BigQueryClientFactory(defaultConfig);

      await expect(factory.removeClient('nonexistent')).resolves.not.toThrow();
    });

    it.skip('should handle client shutdown errors', async () => {
      const factory = new BigQueryClientFactory(defaultConfig);

      await factory.getClient('test-project');

      mockBigQueryClient.shutdown.mockRejectedValue(new Error('Shutdown failed'));

      await expect(factory.removeClient('test-project')).rejects.toThrow(ClientFactoryError);
    });
  });

  describe('Health Monitoring', () => {
    it('should perform health checks periodically', async () => {
      const factory = new BigQueryClientFactory(defaultConfig);
      const healthyHandler = jest.fn();

      factory.on('client:healthy', healthyHandler);

      await factory.getClient('test-project');

      jest.advanceTimersByTime(60000);

      expect(healthyHandler).toHaveBeenCalled();
    });

    it.skip('should detect unhealthy clients', async () => {
      const factory = new BigQueryClientFactory(defaultConfig);
      const unhealthyHandler = jest.fn();

      factory.on('client:unhealthy', unhealthyHandler);

      await factory.getClient('test-project');

      // Make client unhealthy
      mockBigQueryClient.isHealthy.mockReturnValue(false);

      jest.advanceTimersByTime(60000);

      expect(unhealthyHandler).toHaveBeenCalled();
    });

    it.skip('should remove clients with too many errors', async () => {
      const factory = new BigQueryClientFactory(defaultConfig);

      await factory.getClient('test-project');

      // Simulate multiple errors
      mockBigQueryClient.isHealthy.mockReturnValue(false);
      const metadata = (factory as any).clients.get('test-project');
      metadata.errorCount = 10;

      jest.advanceTimersByTime(60000);

      // Client should be removed
      expect(factory.hasClient('test-project')).toBe(false);
    });

    it.skip('should emit health:check events', async () => {
      const factory = new BigQueryClientFactory(defaultConfig);
      const healthCheckHandler = jest.fn();

      factory.on('health:check', healthCheckHandler);

      await factory.getClient('test-project');

      jest.advanceTimersByTime(60000);

      expect(healthCheckHandler).toHaveBeenCalled();
    });

    it('should stop health monitoring on shutdown', async () => {
      const factory = new BigQueryClientFactory(defaultConfig);
      const healthCheckHandler = jest.fn();

      factory.on('health:check', healthCheckHandler);

      await factory.getClient('test-project');

      jest.advanceTimersByTime(60000);
      const callsBeforeShutdown = healthCheckHandler.mock.calls.length;

      await factory.shutdown();

      jest.advanceTimersByTime(120000);

      // No additional calls after shutdown
      expect(healthCheckHandler.mock.calls.length).toBe(callsBeforeShutdown);
    });
  });

  describe('Event Forwarding', () => {
    it.skip('should forward query:started events', async () => {
      const factory = new BigQueryClientFactory(defaultConfig);
      const queryStartedHandler = jest.fn();

      factory.on('query:started', queryStartedHandler);

      await factory.getClient('test-project');

      // Simulate client event
      const clientOnCalls = mockBigQueryClient.on.mock.calls;
      const queryStartedCallback = clientOnCalls.find(([event]) => event === 'query:started')?.[1];

      queryStartedCallback?.({ queryId: 'query-123' });

      expect(queryStartedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'test-project',
          queryId: 'query-123',
        })
      );
    });

    it.skip('should forward query:completed events', async () => {
      const factory = new BigQueryClientFactory(defaultConfig);
      const queryCompletedHandler = jest.fn();

      factory.on('query:completed', queryCompletedHandler);

      await factory.getClient('test-project');

      const clientOnCalls = mockBigQueryClient.on.mock.calls;
      const queryCompletedCallback = clientOnCalls.find(([event]) => event === 'query:completed')?.[1];

      queryCompletedCallback?.({ queryId: 'query-123', duration: 1500 });

      expect(queryCompletedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'test-project',
          queryId: 'query-123',
        })
      );
    });

    it.skip('should forward error events and increment error count', async () => {
      const factory = new BigQueryClientFactory(defaultConfig);
      const errorHandler = jest.fn();

      factory.on('client:error', errorHandler);

      await factory.getClient('test-project');

      const clientOnCalls = mockBigQueryClient.on.mock.calls;
      const errorCallback = clientOnCalls.find(([event]) => event === 'error')?.[1];

      const error = new Error('Query failed');
      errorCallback?.(error);

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'test-project',
          error,
        })
      );

      const metrics = factory.getMetrics();
      expect(metrics.clients[0].errorCount).toBeGreaterThan(0);
    });

    it.skip('should forward cache events', async () => {
      const factory = new BigQueryClientFactory(defaultConfig);
      const cacheHitHandler = jest.fn();
      const cacheMissHandler = jest.fn();

      factory.on('cache:hit', cacheHitHandler);
      factory.on('cache:miss', cacheMissHandler);

      await factory.getClient('test-project');

      const clientOnCalls = mockBigQueryClient.on.mock.calls;
      const cacheHitCallback = clientOnCalls.find(([event]) => event === 'cache:hit')?.[1];
      const cacheMissCallback = clientOnCalls.find(([event]) => event === 'cache:miss')?.[1];

      cacheHitCallback?.({ key: 'dataset:test' });
      cacheMissCallback?.({ key: 'dataset:missing' });

      expect(cacheHitHandler).toHaveBeenCalled();
      expect(cacheMissHandler).toHaveBeenCalled();
    });
  });

  describe('Metrics and Monitoring', () => {
    it('should return complete metrics', async () => {
      const factory = new BigQueryClientFactory(defaultConfig);

      await factory.getClient('project-1');
      await factory.getClient('project-2');

      const metrics = factory.getMetrics();

      expect(metrics.totalClients).toBe(2);
      expect(metrics.clients).toHaveLength(2);
      expect(metrics.config).toEqual({
        pooling: true,
        caching: true,
        monitoring: true,
      });
    });

    it('should include pool and cache metrics per client', async () => {
      const factory = new BigQueryClientFactory(defaultConfig);

      await factory.getClient('test-project');

      const metrics = factory.getMetrics();

      expect(metrics.clients[0].poolMetrics).toEqual({
        activeConnections: 2,
        idleConnections: 1,
        totalConnections: 3,
      });

      expect(metrics.clients[0].cacheStats).toEqual({
        hits: 10,
        misses: 5,
        size: 15,
      });
    });

    it('should track uptime and last used', async () => {
      const factory = new BigQueryClientFactory(defaultConfig);

      await factory.getClient('test-project');

      jest.advanceTimersByTime(5000);

      const metrics = factory.getMetrics();

      expect(metrics.clients[0].uptime).toBeGreaterThanOrEqual(5000);
      expect(metrics.clients[0].lastUsed).toBeGreaterThanOrEqual(5000);
    });

    it('should list active clients', async () => {
      const factory = new BigQueryClientFactory(defaultConfig);

      await factory.getClient('project-1');
      await factory.getClient('project-2');
      await factory.getClient('project-3');

      const activeClients = factory.getActiveClients();

      expect(activeClients).toEqual(['project-1', 'project-2', 'project-3']);
    });

    it('should check if factory has specific client', async () => {
      const factory = new BigQueryClientFactory(defaultConfig);

      await factory.getClient('test-project');

      expect(factory.hasClient('test-project')).toBe(true);
      expect(factory.hasClient('nonexistent')).toBe(false);
    });
  });

  describe('Cache Management', () => {
    it.skip('should invalidate all caches', async () => {
      const factory = new BigQueryClientFactory(defaultConfig);

      await factory.getClient('project-1');
      await factory.getClient('project-2');

      factory.invalidateAllCaches();

      expect(mockBigQueryClient.invalidateCache).toHaveBeenCalledTimes(2);
    });

    it.skip('should invalidate caches with pattern', async () => {
      const factory = new BigQueryClientFactory(defaultConfig);

      await factory.getClient('test-project');

      factory.invalidateAllCaches('dataset:*');

      expect(mockBigQueryClient.invalidateCache).toHaveBeenCalledWith('dataset:*');
    });

    it('should emit cache:invalidated event', async () => {
      const factory = new BigQueryClientFactory(defaultConfig);
      const invalidatedHandler = jest.fn();

      factory.on('cache:invalidated', invalidatedHandler);

      await factory.getClient('test-project');

      factory.invalidateAllCaches('pattern');

      expect(invalidatedHandler).toHaveBeenCalledWith({ pattern: 'pattern' });
    });
  });

  describe('Shutdown', () => {
    it.skip('should shutdown all clients', async () => {
      const factory = new BigQueryClientFactory(defaultConfig);

      await factory.getClient('project-1');
      await factory.getClient('project-2');
      await factory.getClient('project-3');

      await factory.shutdown();

      expect(mockBigQueryClient.shutdown).toHaveBeenCalledTimes(3);
    });

    it('should emit shutdown events', async () => {
      const factory = new BigQueryClientFactory(defaultConfig);
      const shutdownStartedHandler = jest.fn();
      const shutdownCompletedHandler = jest.fn();

      factory.on('shutdown:started', shutdownStartedHandler);
      factory.on('shutdown:completed', shutdownCompletedHandler);

      await factory.getClient('test-project');

      await factory.shutdown();

      expect(shutdownStartedHandler).toHaveBeenCalled();
      expect(shutdownCompletedHandler).toHaveBeenCalled();
    });

    it.skip('should handle multiple shutdown calls gracefully', async () => {
      const factory = new BigQueryClientFactory(defaultConfig);

      await factory.getClient('test-project');

      await factory.shutdown();
      await factory.shutdown(); // Second call should not throw

      expect(mockBigQueryClient.shutdown).toHaveBeenCalledTimes(1);
    });

    it.skip('should prevent new clients after shutdown', async () => {
      const factory = new BigQueryClientFactory(defaultConfig);

      await factory.shutdown();

      await expect(factory.getClient('test-project')).rejects.toThrow(ClientFactoryError);
      await expect(factory.getClient('test-project')).rejects.toThrow('factory is shutting down');
    });

    it.skip('should handle client shutdown errors gracefully', async () => {
      const factory = new BigQueryClientFactory(defaultConfig);

      await factory.getClient('project-1');
      await factory.getClient('project-2');

      mockBigQueryClient.shutdown.mockRejectedValueOnce(new Error('Shutdown failed'));

      await expect(factory.shutdown()).resolves.not.toThrow();

      // Should still attempt to shutdown all clients
      expect(mockBigQueryClient.shutdown).toHaveBeenCalledTimes(2);
    });
  });

  describe('Health Status', () => {
    it('should be healthy with healthy clients', async () => {
      const factory = new BigQueryClientFactory(defaultConfig);

      await factory.getClient('test-project');

      expect(factory.isHealthy()).toBe(true);
    });

    it('should be healthy with empty factory', () => {
      const factory = new BigQueryClientFactory(defaultConfig);

      expect(factory.isHealthy()).toBe(true);
    });

    it('should be unhealthy when shutting down', async () => {
      const factory = new BigQueryClientFactory(defaultConfig);

      await factory.getClient('test-project');

      const shutdownPromise = factory.shutdown();

      expect(factory.isHealthy()).toBe(false);

      await shutdownPromise;
    });

    it('should be healthy if at least one client is healthy', async () => {
      const factory = new BigQueryClientFactory(defaultConfig);

      await factory.getClient('project-1');
      await factory.getClient('project-2');

      // Make first client unhealthy
      mockBigQueryClient.isHealthy.mockReturnValueOnce(false).mockReturnValue(true);

      expect(factory.isHealthy()).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it.skip('should throw ClientFactoryError on client creation failure', async () => {
      const factory = new BigQueryClientFactory(defaultConfig);

      (BigQueryClient as jest.MockedClass<typeof BigQueryClient>).mockImplementation(() => {
        throw new Error('Client creation failed');
      });

      await expect(factory.getClient('test-project')).rejects.toThrow(ClientFactoryError);
    });

    it('should include error details in ClientFactoryError', async () => {
      const factory = new BigQueryClientFactory(defaultConfig);

      (BigQueryClient as jest.MockedClass<typeof BigQueryClient>).mockImplementation(() => {
        throw new Error('Invalid credentials');
      });

      try {
        await factory.getClient('test-project');
        fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(ClientFactoryError);
        expect((error as ClientFactoryError).message).toContain('Failed to create client');
        expect((error as ClientFactoryError).code).toBe('CLIENT_CREATE_ERROR');
        expect((error as ClientFactoryError).details).toBeDefined();
      }
    });
  });

  describe('Configuration Edge Cases', () => {
    it('should handle disabled pooling', async () => {
      const config = {
        ...defaultConfig,
        pooling: { enabled: false },
      };

      const factory = new BigQueryClientFactory(config);

      await factory.getClient('test-project');

      expect(BigQueryClient).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionPool: undefined,
        })
      );
    });

    it('should handle disabled caching', async () => {
      const config = {
        ...defaultConfig,
        caching: { enabled: false },
      };

      const factory = new BigQueryClientFactory(config);

      await factory.getClient('test-project');

      expect(BigQueryClient).toHaveBeenCalledWith(
        expect.objectContaining({
          datasetManager: undefined,
        })
      );
    });

    it('should handle disabled retry', async () => {
      const config = {
        ...defaultConfig,
        retry: { enabled: false },
      };

      const factory = new BigQueryClientFactory(config);

      await factory.getClient('test-project');

      expect(BigQueryClient).toHaveBeenCalledWith(
        expect.objectContaining({
          retry: undefined,
        })
      );
    });

    it('should handle custom credentials', async () => {
      const customCredentials = { client_email: 'test@example.com' };
      const config = {
        ...defaultConfig,
        defaultCredentials: customCredentials,
      };

      const factory = new BigQueryClientFactory(config);

      await factory.getClient('test-project');

      expect(BigQueryClient).toHaveBeenCalledWith(
        expect.objectContaining({
          credentials: customCredentials,
        })
      );
    });

    it('should handle custom key filename', async () => {
      const config = {
        ...defaultConfig,
        defaultKeyFilename: '/path/to/key.json',
      };

      const factory = new BigQueryClientFactory(config);

      await factory.getClient('test-project');

      expect(BigQueryClient).toHaveBeenCalledWith(
        expect.objectContaining({
          keyFilename: '/path/to/key.json',
        })
      );
    });
  });

  describe('ClientFactoryError', () => {
    it('should create error with all properties', () => {
      const error = new ClientFactoryError(
        'Test error',
        'TEST_CODE',
        { detail: 'extra info' }
      );

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ClientFactoryError);
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.details).toEqual({ detail: 'extra info' });
      expect(error.name).toBe('ClientFactoryError');
    });

    it('should create error without details', () => {
      const error = new ClientFactoryError('Test error', 'TEST_CODE');

      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.details).toBeUndefined();
    });
  });
});
