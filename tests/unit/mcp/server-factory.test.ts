import { EventEmitter } from 'events';
import {
  MCPServerFactory,
  ServerFactoryConfig,
  ServerState,
  ServerFactoryError,
  ServerFactoryConfigSchema,
} from '../../../src/mcp/server-factory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

// Mock dependencies
jest.mock('@modelcontextprotocol/sdk/server/index.js');
jest.mock('@modelcontextprotocol/sdk/server/stdio.js');
jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('MCPServerFactory', () => {
  let mockServer: jest.Mocked<Server>;
  let mockTransport: jest.Mocked<StdioServerTransport>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock Server instance
    mockServer = {
      connect: jest.fn(),
      close: jest.fn(),
    } as any;

    // Mock Transport instance
    mockTransport = {
      close: jest.fn(),
    } as any;

    (Server as jest.MockedClass<typeof Server>).mockImplementation(() => mockServer);
    (StdioServerTransport as jest.MockedClass<typeof StdioServerTransport>).mockImplementation(() => mockTransport);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Constructor and Initialization', () => {
    it('should create factory with default configuration', () => {
      const config: ServerFactoryConfig = {
        transport: 'stdio',
      };

      const factory = new MCPServerFactory(config);

      expect(factory).toBeInstanceOf(MCPServerFactory);
      expect(factory).toBeInstanceOf(EventEmitter);
      expect(factory.getState()).toBe(ServerState.READY);
    });

    it('should create factory with full configuration', () => {
      const config: ServerFactoryConfig = {
        name: 'test-server',
        version: '2.0.0',
        description: 'Test MCP Server',
        capabilities: {
          tools: true,
          resources: true,
          prompts: true,
          logging: true,
        },
        transport: 'stdio',
        gracefulShutdownTimeoutMs: 60000,
        healthCheckIntervalMs: 30000,
      };

      const factory = new MCPServerFactory(config);
      const metadata = factory.getMetadata();

      expect(metadata.name).toBe('test-server');
      expect(metadata.version).toBe('2.0.0');
      expect(metadata.description).toBe('Test MCP Server');
      expect(metadata.state).toBe(ServerState.READY);
    });

    it('should apply default values for missing config', () => {
      const config: ServerFactoryConfig = {
        transport: 'stdio',
      };

      const factory = new MCPServerFactory(config);
      const metadata = factory.getMetadata();

      expect(metadata.name).toBe('mcp-server');
      expect(metadata.version).toBe('1.0.0');
      expect(metadata.capabilities.tools).toBe(true);
      expect(metadata.capabilities.resources).toBe(true);
      expect(metadata.capabilities.prompts).toBe(false);
      expect(metadata.capabilities.logging).toBe(true);
    });

    it('should validate configuration with Zod schema', () => {
      const invalidConfig = {
        transport: 'stdio',
        gracefulShutdownTimeoutMs: 500, // Below minimum
      };

      expect(() => {
        new MCPServerFactory(invalidConfig as ServerFactoryConfig);
      }).toThrow();
    });

    it('should create MCP Server with correct options', () => {
      const config: ServerFactoryConfig = {
        name: 'test-server',
        version: '1.5.0',
        transport: 'stdio',
      };

      new MCPServerFactory(config);

      expect(Server).toHaveBeenCalledWith(
        {
          name: 'test-server',
          version: '1.5.0',
        },
        expect.objectContaining({
          capabilities: expect.any(Object),
        })
      );
    });
  });

  describe('State Management', () => {
    it('should initialize in READY state', () => {
      const config: ServerFactoryConfig = { transport: 'stdio' };
      const factory = new MCPServerFactory(config);

      expect(factory.getState()).toBe(ServerState.READY);
      expect(factory.isHealthy()).toBe(true);
    });

    it('should transition to RUNNING state on start', async () => {
      const config: ServerFactoryConfig = { transport: 'stdio' };
      const factory = new MCPServerFactory(config);

      mockServer.connect.mockResolvedValue(undefined);

      await factory.start();

      expect(factory.getState()).toBe(ServerState.RUNNING);
      expect(factory.isHealthy()).toBe(true);
    });

    it('should transition to SHUTTING_DOWN state on shutdown', async () => {
      const config: ServerFactoryConfig = { transport: 'stdio' };
      const factory = new MCPServerFactory(config);

      mockServer.connect.mockResolvedValue(undefined);
      await factory.start();

      const shutdownPromise = factory.shutdown();

      expect(factory.getState()).toBe(ServerState.SHUTTING_DOWN);

      await shutdownPromise;
    });

    it('should transition to STOPPED state after shutdown completes', async () => {
      const config: ServerFactoryConfig = { transport: 'stdio' };
      const factory = new MCPServerFactory(config);

      mockServer.connect.mockResolvedValue(undefined);
      await factory.start();
      await factory.shutdown();

      expect(factory.getState()).toBe(ServerState.STOPPED);
      expect(factory.isHealthy()).toBe(false);
    });

    it('should transition to ERROR state on start failure', async () => {
      const config: ServerFactoryConfig = { transport: 'stdio' };
      const factory = new MCPServerFactory(config);

      mockServer.connect.mockRejectedValue(new Error('Connection failed'));

      await expect(factory.start()).rejects.toThrow(ServerFactoryError);
      expect(factory.getState()).toBe(ServerState.ERROR);
      expect(factory.isHealthy()).toBe(false);
    });

    it('should emit state:changed events', async () => {
      const config: ServerFactoryConfig = { transport: 'stdio' };
      const factory = new MCPServerFactory(config);

      const stateChanges: any[] = [];
      factory.on('state:changed', (data) => stateChanges.push(data));

      mockServer.connect.mockResolvedValue(undefined);
      await factory.start();

      expect(stateChanges).toContainEqual({
        oldState: ServerState.READY,
        newState: ServerState.RUNNING,
      });
    });
  });

  describe('Server Lifecycle', () => {
    it('should start server successfully', async () => {
      const config: ServerFactoryConfig = { transport: 'stdio' };
      const factory = new MCPServerFactory(config);

      mockServer.connect.mockResolvedValue(undefined);

      await factory.start();

      expect(mockServer.connect).toHaveBeenCalledWith(mockTransport);
      expect(factory.getState()).toBe(ServerState.RUNNING);
    });

    it('should throw error when starting from invalid state', async () => {
      const config: ServerFactoryConfig = { transport: 'stdio' };
      const factory = new MCPServerFactory(config);

      mockServer.connect.mockResolvedValue(undefined);
      await factory.start();

      // Try to start again
      await expect(factory.start()).rejects.toThrow(ServerFactoryError);
      await expect(factory.start()).rejects.toThrow('Cannot start server in state');
    });

    it('should emit started event on successful start', async () => {
      const config: ServerFactoryConfig = { transport: 'stdio' };
      const factory = new MCPServerFactory(config);

      const startedHandler = jest.fn();
      factory.on('started', startedHandler);

      mockServer.connect.mockResolvedValue(undefined);
      await factory.start();

      expect(startedHandler).toHaveBeenCalled();
    });

    it('should emit error event on start failure', async () => {
      const config: ServerFactoryConfig = { transport: 'stdio' };
      const factory = new MCPServerFactory(config);

      const errorHandler = jest.fn();
      factory.on('error', errorHandler);

      const error = new Error('Start failed');
      mockServer.connect.mockRejectedValue(error);

      await expect(factory.start()).rejects.toThrow();
      expect(errorHandler).toHaveBeenCalledWith(error);
    });

    it('should shutdown gracefully', async () => {
      const config: ServerFactoryConfig = { transport: 'stdio' };
      const factory = new MCPServerFactory(config);

      mockServer.connect.mockResolvedValue(undefined);
      mockTransport.close = jest.fn().mockResolvedValue(undefined);

      await factory.start();
      await factory.shutdown();

      expect(factory.getState()).toBe(ServerState.STOPPED);
    });

    it('should emit shutdown events', async () => {
      const config: ServerFactoryConfig = { transport: 'stdio' };
      const factory = new MCPServerFactory(config);

      const shutdownStarted = jest.fn();
      const shutdownCompleted = jest.fn();

      factory.on('shutdown:started', shutdownStarted);
      factory.on('shutdown:completed', shutdownCompleted);

      mockServer.connect.mockResolvedValue(undefined);
      await factory.start();
      await factory.shutdown('test reason');

      expect(shutdownStarted).toHaveBeenCalledWith({ reason: 'test reason' });
      expect(shutdownCompleted).toHaveBeenCalled();
    });

    it('should handle multiple shutdown calls gracefully', async () => {
      const config: ServerFactoryConfig = { transport: 'stdio' };
      const factory = new MCPServerFactory(config);

      mockServer.connect.mockResolvedValue(undefined);
      await factory.start();

      await factory.shutdown();
      await factory.shutdown(); // Second call should not throw

      expect(factory.getState()).toBe(ServerState.STOPPED);
    });

    it('should timeout shutdown if exceeds graceful timeout', async () => {
      const config: ServerFactoryConfig = {
        transport: 'stdio',
        gracefulShutdownTimeoutMs: 100,
      };
      const factory = new MCPServerFactory(config);

      mockServer.connect.mockResolvedValue(undefined);
      mockTransport.close = jest.fn().mockImplementation(
        () => new Promise(resolve => setTimeout(resolve, 500))
      );

      await factory.start();

      await expect(factory.shutdown()).rejects.toThrow(ServerFactoryError);
      await expect(factory.shutdown()).rejects.toThrow('Shutdown timeout');
    });
  });

  describe('Transport Management', () => {
    it('should create stdio transport', async () => {
      const config: ServerFactoryConfig = { transport: 'stdio' };
      const factory = new MCPServerFactory(config);

      mockServer.connect.mockResolvedValue(undefined);
      await factory.start();

      expect(StdioServerTransport).toHaveBeenCalled();
      expect(mockServer.connect).toHaveBeenCalledWith(mockTransport);
    });

    it('should throw error for unimplemented transport types', async () => {
      const config: ServerFactoryConfig = { transport: 'sse' };
      const factory = new MCPServerFactory(config);

      await expect(factory.start()).rejects.toThrow(ServerFactoryError);
      await expect(factory.start()).rejects.toThrow('not yet implemented');
    });

    it('should throw error for unknown transport type', async () => {
      const config: ServerFactoryConfig = { transport: 'invalid' as any };
      const factory = new MCPServerFactory(config);

      await expect(factory.start()).rejects.toThrow(ServerFactoryError);
      await expect(factory.start()).rejects.toThrow('Unknown transport');
    });
  });

  describe('Health Monitoring', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should start health monitoring when configured', async () => {
      const config: ServerFactoryConfig = {
        transport: 'stdio',
        healthCheckIntervalMs: 5000,
      };
      const factory = new MCPServerFactory(config);

      const healthCheckHandler = jest.fn();
      factory.on('health:check', healthCheckHandler);

      mockServer.connect.mockResolvedValue(undefined);
      await factory.start();

      jest.advanceTimersByTime(5000);

      expect(healthCheckHandler).toHaveBeenCalled();
    });

    it('should emit health:check events periodically', async () => {
      const config: ServerFactoryConfig = {
        transport: 'stdio',
        healthCheckIntervalMs: 1000,
      };
      const factory = new MCPServerFactory(config);

      const healthCheckHandler = jest.fn();
      factory.on('health:check', healthCheckHandler);

      mockServer.connect.mockResolvedValue(undefined);
      await factory.start();

      jest.advanceTimersByTime(3000);

      expect(healthCheckHandler).toHaveBeenCalledTimes(3);
    });

    it('should stop health monitoring on shutdown', async () => {
      const config: ServerFactoryConfig = {
        transport: 'stdio',
        healthCheckIntervalMs: 1000,
      };
      const factory = new MCPServerFactory(config);

      const healthCheckHandler = jest.fn();
      factory.on('health:check', healthCheckHandler);

      mockServer.connect.mockResolvedValue(undefined);
      await factory.start();

      jest.advanceTimersByTime(1000);
      const callsBeforeShutdown = healthCheckHandler.mock.calls.length;

      await factory.shutdown();

      jest.advanceTimersByTime(5000);

      // No additional health checks after shutdown
      expect(healthCheckHandler.mock.calls.length).toBe(callsBeforeShutdown);
    });

    it('should not start health monitoring when not configured', async () => {
      const config: ServerFactoryConfig = {
        transport: 'stdio',
      };
      const factory = new MCPServerFactory(config);

      const healthCheckHandler = jest.fn();
      factory.on('health:check', healthCheckHandler);

      mockServer.connect.mockResolvedValue(undefined);
      await factory.start();

      jest.advanceTimersByTime(10000);

      expect(healthCheckHandler).not.toHaveBeenCalled();
    });
  });

  describe('Metadata and Getters', () => {
    it('should return server instance', () => {
      const config: ServerFactoryConfig = { transport: 'stdio' };
      const factory = new MCPServerFactory(config);

      const server = factory.getServer();

      expect(server).toBe(mockServer);
    });

    it('should return complete metadata', () => {
      const config: ServerFactoryConfig = {
        name: 'test-server',
        version: '3.0.0',
        description: 'Test Description',
        capabilities: {
          tools: true,
          resources: false,
          prompts: true,
          logging: false,
        },
        transport: 'stdio',
      };
      const factory = new MCPServerFactory(config);

      const metadata = factory.getMetadata();

      expect(metadata).toEqual({
        name: 'test-server',
        version: '3.0.0',
        description: 'Test Description',
        state: ServerState.READY,
        capabilities: {
          tools: true,
          resources: false,
          prompts: true,
          logging: false,
        },
        transport: 'stdio',
      });
    });

    it('should check health correctly', () => {
      const config: ServerFactoryConfig = { transport: 'stdio' };
      const factory = new MCPServerFactory(config);

      expect(factory.isHealthy()).toBe(true); // READY state

      // Manually set state to ERROR for testing
      (factory as any).state = ServerState.ERROR;
      expect(factory.isHealthy()).toBe(false);

      (factory as any).state = ServerState.RUNNING;
      expect(factory.isHealthy()).toBe(true);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle config validation errors', () => {
      const invalidConfigs = [
        { transport: 'stdio', gracefulShutdownTimeoutMs: 100 }, // Below minimum
        { transport: 'invalid' as any },
      ];

      invalidConfigs.forEach((config) => {
        expect(() => {
          new MCPServerFactory(config);
        }).toThrow();
      });
    });

    it('should handle transport creation errors', async () => {
      const config: ServerFactoryConfig = { transport: 'stdio' };
      const factory = new MCPServerFactory(config);

      (StdioServerTransport as jest.MockedClass<typeof StdioServerTransport>).mockImplementation(() => {
        throw new Error('Transport creation failed');
      });

      await expect(factory.start()).rejects.toThrow(ServerFactoryError);
    });

    it('should handle server connection errors', async () => {
      const config: ServerFactoryConfig = { transport: 'stdio' };
      const factory = new MCPServerFactory(config);

      mockServer.connect.mockRejectedValue(new Error('Connection error'));

      await expect(factory.start()).rejects.toThrow(ServerFactoryError);
      expect(factory.getState()).toBe(ServerState.ERROR);
    });

    it('should handle shutdown errors gracefully', async () => {
      const config: ServerFactoryConfig = { transport: 'stdio' };
      const factory = new MCPServerFactory(config);

      mockServer.connect.mockResolvedValue(undefined);
      mockTransport.close = jest.fn().mockRejectedValue(new Error('Close error'));

      await factory.start();

      const errorHandler = jest.fn();
      factory.on('shutdown:error', errorHandler);

      await expect(factory.shutdown()).rejects.toThrow();
      expect(errorHandler).toHaveBeenCalled();
    });

    it('should not register shutdown handlers multiple times', async () => {
      const config: ServerFactoryConfig = { transport: 'stdio' };
      const factory = new MCPServerFactory(config);

      mockServer.connect.mockResolvedValue(undefined);

      await factory.start();

      // Verify shutdown handlers are registered only once
      expect((factory as any).shutdownHandlersRegistered).toBe(true);
    });
  });

  describe('ServerFactoryError', () => {
    it('should create error with all properties', () => {
      const error = new ServerFactoryError(
        'Test error',
        'TEST_CODE',
        { detail: 'extra info' }
      );

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ServerFactoryError);
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.details).toEqual({ detail: 'extra info' });
      expect(error.name).toBe('ServerFactoryError');
    });

    it('should create error without details', () => {
      const error = new ServerFactoryError('Test error', 'TEST_CODE');

      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.details).toBeUndefined();
    });
  });
});
