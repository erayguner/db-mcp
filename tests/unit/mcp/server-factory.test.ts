import { jest } from '@jest/globals';
import { EventEmitter } from 'events';
import type { ServerFactoryConfig } from '../../../src/mcp/server-factory.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

// ESM-native mocking: `jest.mock()` does not intercept static ESM imports under
// the ts-jest ESM preset, so the real SDK class was being loaded and
// `Server.mockImplementation` did not exist. `jest.unstable_mockModule` +
// a dynamic `await import()` of the module under test is the supported
// pattern, and it scopes these mocks to this file instead of swapping a stub
// SDK into every suite via a global moduleNameMapper entry.
const MockServer = jest.fn();
const MockStdioServerTransport = jest.fn();

jest.unstable_mockModule('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: MockServer,
}));

jest.unstable_mockModule('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: MockStdioServerTransport,
}));

const loggerMock = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

jest.unstable_mockModule('../../../src/utils/logger.js', () => ({
  logger: loggerMock,
  default: loggerMock,
}));

// Must be imported dynamically, after the mock registrations above.
const { MCPServerFactory, ServerState, ServerFactoryError } =
  await import('../../../src/mcp/server-factory.js');

/** The process events MCPServerFactory hooks for graceful shutdown. */
const SHUTDOWN_EVENTS = ['SIGTERM', 'SIGINT', 'uncaughtException', 'unhandledRejection'] as const;

describe('MCPServerFactory', () => {
  let mockServer: jest.Mocked<Server>;
  let mockTransport: jest.Mocked<StdioServerTransport>;

  const createDefaultConfig = (
    overrides: Partial<ServerFactoryConfig> = {}
  ): ServerFactoryConfig => ({
    name: 'test-server',
    version: '1.0.0',
    capabilities: {
      tools: true,
      resources: true,
      prompts: false,
      logging: true,
    },
    transport: 'stdio',
    gracefulShutdownTimeoutMs: 30000,
    ...overrides,
  });

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

    MockServer.mockImplementation(() => mockServer);
    MockStdioServerTransport.mockImplementation(() => mockTransport);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Constructor and Initialization', () => {
    it('should create factory with default configuration', () => {
      const config: ServerFactoryConfig = {
        name: 'test-server',
        version: '1.0.0',
        capabilities: {
          tools: true,
          resources: true,
          prompts: false,
          logging: true,
        },
        transport: 'stdio',
        gracefulShutdownTimeoutMs: 30000,
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
      const config = createDefaultConfig();

      const factory = new MCPServerFactory(config);
      const metadata = factory.getMetadata();

      expect(metadata.name).toBe('test-server');
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
      const config = createDefaultConfig({
        version: '1.5.0',
      });

      new MCPServerFactory(config);

      expect(MockServer).toHaveBeenCalledWith(
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
      const config = createDefaultConfig();
      const factory = new MCPServerFactory(config);

      expect(factory.getState()).toBe(ServerState.READY);
      expect(factory.isHealthy()).toBe(true);
    });

    it('should transition to RUNNING state on start', async () => {
      const config = createDefaultConfig();
      const factory = new MCPServerFactory(config);

      mockServer.connect.mockResolvedValue(undefined);

      await factory.start();

      expect(factory.getState()).toBe(ServerState.RUNNING);
      expect(factory.isHealthy()).toBe(true);
    });

    it('should transition to SHUTTING_DOWN state on shutdown', async () => {
      const config = createDefaultConfig();
      const factory = new MCPServerFactory(config);

      mockServer.connect.mockResolvedValue(undefined);
      await factory.start();

      const shutdownPromise = factory.shutdown();

      expect(factory.getState()).toBe(ServerState.SHUTTING_DOWN);

      await shutdownPromise;
    });

    it('should transition to STOPPED state after shutdown completes', async () => {
      const config = createDefaultConfig();
      const factory = new MCPServerFactory(config);

      mockServer.connect.mockResolvedValue(undefined);
      await factory.start();
      await factory.shutdown();

      expect(factory.getState()).toBe(ServerState.STOPPED);
      expect(factory.isHealthy()).toBe(false);
    });

    it('should transition to ERROR state on start failure', async () => {
      const config = createDefaultConfig();
      const factory = new MCPServerFactory(config);

      mockServer.connect.mockRejectedValue(new Error('Connection failed'));

      await expect(factory.start()).rejects.toThrow(ServerFactoryError);
      expect(factory.getState()).toBe(ServerState.ERROR);
      expect(factory.isHealthy()).toBe(false);
    });

    it('should emit state:changed events', async () => {
      const config = createDefaultConfig();
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
      const config = createDefaultConfig();
      const factory = new MCPServerFactory(config);

      mockServer.connect.mockResolvedValue(undefined);

      await factory.start();

      expect(mockServer.connect).toHaveBeenCalledWith(mockTransport);
      expect(factory.getState()).toBe(ServerState.RUNNING);
    });

    it('should throw error when starting from invalid state', async () => {
      const config = createDefaultConfig();
      const factory = new MCPServerFactory(config);

      mockServer.connect.mockResolvedValue(undefined);
      await factory.start();

      // Try to start again
      await expect(factory.start()).rejects.toThrow(ServerFactoryError);
      await expect(factory.start()).rejects.toThrow('Cannot start server in state');
    });

    it('should emit started event on successful start', async () => {
      const config = createDefaultConfig();
      const factory = new MCPServerFactory(config);

      const startedHandler = jest.fn();
      factory.on('started', startedHandler);

      mockServer.connect.mockResolvedValue(undefined);
      await factory.start();

      expect(startedHandler).toHaveBeenCalled();
    });

    it('should emit error event on start failure', async () => {
      const config = createDefaultConfig();
      const factory = new MCPServerFactory(config);

      const errorHandler = jest.fn();
      factory.on('error', errorHandler);

      const error = new Error('Start failed');
      mockServer.connect.mockRejectedValue(error);

      await expect(factory.start()).rejects.toThrow();
      expect(errorHandler).toHaveBeenCalledWith(error);
    });

    it('should shutdown gracefully', async () => {
      const config = createDefaultConfig();
      const factory = new MCPServerFactory(config);

      mockServer.connect.mockResolvedValue(undefined);
      mockTransport.close = jest.fn().mockResolvedValue(undefined);

      await factory.start();
      await factory.shutdown();

      expect(factory.getState()).toBe(ServerState.STOPPED);
    });

    it('should emit shutdown events', async () => {
      const config = createDefaultConfig();
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
      const config = createDefaultConfig();
      const factory = new MCPServerFactory(config);

      mockServer.connect.mockResolvedValue(undefined);
      await factory.start();

      await factory.shutdown();
      await factory.shutdown(); // Second call should not throw

      expect(factory.getState()).toBe(ServerState.STOPPED);
    });

    it('should timeout shutdown if exceeds graceful timeout', async () => {
      // 1000ms is the schema minimum for gracefulShutdownTimeoutMs; the old
      // value of 100 failed Zod validation in the constructor, so this test
      // never reached the shutdown path it claims to cover. Fake timers keep
      // the run instant while still exercising the real timeout race.
      jest.useFakeTimers();

      try {
        const config = createDefaultConfig({ gracefulShutdownTimeoutMs: 1000 });
        const factory = new MCPServerFactory(config);

        mockServer.connect.mockResolvedValue(undefined);
        // Transport close never settles, so the graceful timeout must win.
        mockTransport.close = jest.fn().mockImplementation(() => new Promise(() => {}));

        await factory.start();

        // Attach the rejection assertion before advancing the clock, otherwise
        // the timer fires while the promise still has no handler and Jest
        // reports it as an unhandled rejection.
        const firstShutdown = expect(factory.shutdown()).rejects.toThrow(ServerFactoryError);
        await jest.advanceTimersByTimeAsync(1000);
        await firstShutdown;

        const secondShutdown = expect(factory.shutdown()).rejects.toThrow('Shutdown timeout');
        await jest.advanceTimersByTimeAsync(1000);
        await secondShutdown;
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('Transport Management', () => {
    it('should create stdio transport', async () => {
      const config = createDefaultConfig();
      const factory = new MCPServerFactory(config);

      mockServer.connect.mockResolvedValue(undefined);
      await factory.start();

      expect(MockStdioServerTransport).toHaveBeenCalled();
      expect(mockServer.connect).toHaveBeenCalledWith(mockTransport);
    });

    it('should throw error for unimplemented transport types', async () => {
      // A fresh factory per assertion: a failed start() leaves the factory in
      // ERROR, so a second start() on the same instance would reject with
      // "Cannot start server in state: error" rather than the transport error.
      await expect(
        new MCPServerFactory(createDefaultConfig({ transport: 'sse' })).start()
      ).rejects.toThrow(ServerFactoryError);

      await expect(
        new MCPServerFactory(createDefaultConfig({ transport: 'sse' })).start()
      ).rejects.toThrow('not yet implemented');
    });

    it('should throw error for unknown transport type', async () => {
      // The Zod enum rejects an unknown transport at construction time, so the
      // UNKNOWN_TRANSPORT guard in createTransport() is only reachable by
      // bypassing validation. Poke the private config to exercise that
      // defensive branch (the suite already does this for `state` elsewhere).
      const makeFactoryWithBadTransport = () => {
        const factory = new MCPServerFactory(createDefaultConfig());
        (factory as any).config.transport = 'invalid';
        return factory;
      };

      await expect(makeFactoryWithBadTransport().start()).rejects.toThrow(ServerFactoryError);
      await expect(makeFactoryWithBadTransport().start()).rejects.toThrow('Unknown transport');
    });

    it('should reject an unknown transport at construction time', () => {
      expect(() => {
        new MCPServerFactory(createDefaultConfig({ transport: 'invalid' as any }));
      }).toThrow();
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
      const config = createDefaultConfig({
        healthCheckIntervalMs: 5000,
      });
      const factory = new MCPServerFactory(config);

      const healthCheckHandler = jest.fn();
      factory.on('health:check', healthCheckHandler);

      mockServer.connect.mockResolvedValue(undefined);
      await factory.start();

      jest.advanceTimersByTime(5000);

      expect(healthCheckHandler).toHaveBeenCalled();
    });

    it('should emit health:check events periodically', async () => {
      const config = createDefaultConfig({
        healthCheckIntervalMs: 1000,
      });
      const factory = new MCPServerFactory(config);

      const healthCheckHandler = jest.fn();
      factory.on('health:check', healthCheckHandler);

      mockServer.connect.mockResolvedValue(undefined);
      await factory.start();

      jest.advanceTimersByTime(3000);

      expect(healthCheckHandler).toHaveBeenCalledTimes(3);
    });

    it('should stop health monitoring on shutdown', async () => {
      const config = createDefaultConfig({
        healthCheckIntervalMs: 1000,
      });
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
      const config = createDefaultConfig();
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
      const config = createDefaultConfig();
      const factory = new MCPServerFactory(config);

      const server = factory.getServer();

      expect(server).toBe(mockServer);
    });

    it('should return complete metadata', () => {
      const config = createDefaultConfig({
        version: '3.0.0',
        description: 'Test Description',
        capabilities: {
          tools: true,
          resources: false,
          prompts: true,
          logging: false,
        },
      });
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
      const config = createDefaultConfig();
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
      const invalidConfig = createDefaultConfig({ gracefulShutdownTimeoutMs: 100 }); // Below minimum

      expect(() => {
        new MCPServerFactory(invalidConfig);
      }).toThrow();
    });

    it('should handle transport creation errors', async () => {
      const config = createDefaultConfig();
      const factory = new MCPServerFactory(config);

      MockStdioServerTransport.mockImplementation(() => {
        throw new Error('Transport creation failed');
      });

      await expect(factory.start()).rejects.toThrow(ServerFactoryError);
    });

    it('should handle server connection errors', async () => {
      const config = createDefaultConfig();
      const factory = new MCPServerFactory(config);

      mockServer.connect.mockRejectedValue(new Error('Connection error'));

      await expect(factory.start()).rejects.toThrow(ServerFactoryError);
      expect(factory.getState()).toBe(ServerState.ERROR);
    });

    it('should handle shutdown errors gracefully', async () => {
      const config = createDefaultConfig();
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
      const config = createDefaultConfig();
      const factory = new MCPServerFactory(config);

      mockServer.connect.mockResolvedValue(undefined);

      const before = SHUTDOWN_EVENTS.map((e) => process.listenerCount(e));

      await factory.start();

      // Assert on the real process listener counts, not on a private flag. The
      // flag was true while four listeners per instance leaked, which is how
      // MaxListenersExceededWarning went unnoticed.
      SHUTDOWN_EVENTS.forEach((event, i) => {
        expect(process.listenerCount(event)).toBe(before[i] + 1);
      });

      await factory.shutdown();
    });
  });

  describe('Process listener lifecycle', () => {
    it('removes every process listener it registered on shutdown', async () => {
      const factory = new MCPServerFactory(createDefaultConfig());
      mockServer.connect.mockResolvedValue(undefined);

      const before = SHUTDOWN_EVENTS.map((e) => process.listenerCount(e));

      await factory.start();
      await factory.shutdown();

      SHUTDOWN_EVENTS.forEach((event, i) => {
        expect(process.listenerCount(event)).toBe(before[i]);
      });
    });

    it('does not leak listeners across repeated construct/start/shutdown cycles', async () => {
      mockServer.connect.mockResolvedValue(undefined);

      const before = SHUTDOWN_EVENTS.map((e) => process.listenerCount(e));

      // Well past Node's default max-listeners threshold of 10. Before the fix
      // this left 60 orphaned listeners and emitted MaxListenersExceededWarning.
      for (let i = 0; i < 15; i++) {
        const factory = new MCPServerFactory(createDefaultConfig());
        await factory.start();
        await factory.shutdown();
      }

      SHUTDOWN_EVENTS.forEach((event, i) => {
        expect(process.listenerCount(event)).toBe(before[i]);
      });
    });

    it('releases listeners even when closing the transport fails', async () => {
      const factory = new MCPServerFactory(createDefaultConfig());
      mockServer.connect.mockResolvedValue(undefined);
      mockTransport.close = jest.fn().mockRejectedValue(new Error('Close error'));

      const before = SHUTDOWN_EVENTS.map((e) => process.listenerCount(e));

      await factory.start();
      await expect(factory.shutdown()).rejects.toThrow();

      SHUTDOWN_EVENTS.forEach((event, i) => {
        expect(process.listenerCount(event)).toBe(before[i]);
      });
    });

    it('registers a single set of listeners even if start is retried', async () => {
      const factory = new MCPServerFactory(createDefaultConfig());
      mockServer.connect.mockResolvedValue(undefined);

      const before = SHUTDOWN_EVENTS.map((e) => process.listenerCount(e));

      await factory.start();
      // A second start() is rejected by the state machine, but registration
      // must be idempotent regardless of how it is reached.
      await expect(factory.start()).rejects.toThrow(ServerFactoryError);
      (factory as any).registerShutdownHandlers();

      SHUTDOWN_EVENTS.forEach((event, i) => {
        expect(process.listenerCount(event)).toBe(before[i] + 1);
      });

      await factory.shutdown();
    });
  });

  describe('ServerFactoryError', () => {
    it('should create error with all properties', () => {
      const error = new ServerFactoryError('Test error', 'TEST_CODE', { detail: 'extra info' });

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
