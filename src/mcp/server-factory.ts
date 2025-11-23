import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { z } from 'zod';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';

/**
 * MCP Server Factory Configuration Schema
 */
export const ServerFactoryConfigSchema = z.object({
  name: z.string().default('mcp-server'),
  version: z.string().default('1.0.0'),
  description: z.string().optional(),
  capabilities: z.object({
    tools: z.boolean().default(true),
    resources: z.boolean().default(true),
    prompts: z.boolean().default(false),
    logging: z.boolean().default(true),
  }).default({}),
  transport: z.enum(['stdio', 'sse', 'websocket']).default('stdio'),
  gracefulShutdownTimeoutMs: z.number().min(1000).default(30000),
  healthCheckIntervalMs: z.number().min(1000).optional(),
});

export type ServerFactoryConfig = z.infer<typeof ServerFactoryConfigSchema>;

/**
 * MCP Server Lifecycle States
 */
export enum ServerState {
  INITIALIZING = 'initializing',
  READY = 'ready',
  RUNNING = 'running',
  SHUTTING_DOWN = 'shutting_down',
  STOPPED = 'stopped',
  ERROR = 'error',
}

/**
 * Server Factory Error
 */
export class ServerFactoryError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ServerFactoryError';
  }
}

/**
 * MCP Server Factory
 *
 * Manages the lifecycle of an MCP server including:
 * - Initialization and configuration
 * - Transport management
 * - Graceful shutdown
 * - Health monitoring
 * - Event emission
 */
export class MCPServerFactory extends EventEmitter {
  private config: ServerFactoryConfig;
  private server: Server; // revert type
  private transport: Transport | null = null;
  private state: ServerState = ServerState.INITIALIZING;
  private healthCheckInterval?: NodeJS.Timeout;
  private shutdownHandlersRegistered = false;

  constructor(config: ServerFactoryConfig) {
    super();
    this.config = this.parseAndValidateConfig(config);
    const ServerClass = Server as any;
    this.server = new ServerClass({
      name: this.config.name,
      version: this.config.version,
      capabilities: {
        tools: this.config.capabilities.tools ? {} : undefined,
        resources: this.config.capabilities.resources ? {} : undefined,
        prompts: this.config.capabilities.prompts ? {} : undefined,
        logging: this.config.capabilities.logging ? {} : undefined,
      }
    });
    this.setState(ServerState.READY);
    logger.info('MCP Server Factory initialized', {
      name: this.config.name,
      version: this.config.version,
      transport: this.config.transport,
    });
  }

  private parseAndValidateConfig(config: ServerFactoryConfig): ServerFactoryConfig {
    const parsed = ServerFactoryConfigSchema.parse(config);

    return {
      name: parsed.name,
      version: parsed.version,
      description: parsed.description ?? '',
      capabilities: {
        tools: parsed.capabilities.tools ?? true,
        resources: parsed.capabilities.resources ?? true,
        prompts: parsed.capabilities.prompts ?? false,
        logging: parsed.capabilities.logging ?? true,
      },
      transport: parsed.transport,
      gracefulShutdownTimeoutMs: parsed.gracefulShutdownTimeoutMs ?? 30000,
      healthCheckIntervalMs: parsed.healthCheckIntervalMs ?? 60000,
    };
  }

  /**
   * Get the underlying MCP Server instance
   */
  public getServer(): Server {
    return this.server;
  }

  /**
   * Get current server state
   */
  public getState(): ServerState {
    return this.state;
  }

  /**
   * Check if server is healthy
   */
  public isHealthy(): boolean {
    return this.state === ServerState.RUNNING || this.state === ServerState.READY;
  }

  /**
   * Set server state and emit event
   */
  private setState(newState: ServerState): void {
    const oldState = this.state;
    this.state = newState;

    this.emit('state:changed', { oldState, newState });
    logger.info('Server state changed', { oldState, newState });
  }

  /**
   * Create and configure transport based on config
   */
  private createTransport(): Transport {
    switch (this.config.transport) {
      case 'stdio':
        return new StdioServerTransport();

      case 'sse':
      case 'websocket':
        throw new ServerFactoryError(
          `Transport ${this.config.transport} not yet implemented`,
          'TRANSPORT_NOT_IMPLEMENTED'
        );

      default: {
        const transport: never = this.config.transport;
        throw new ServerFactoryError(
          `Unknown transport: ${String(transport)}`,
          'UNKNOWN_TRANSPORT'
        );
      }
    }
  }

  /**
   * Start the MCP server
   */
  public async start(): Promise<void> {
    if (this.state !== ServerState.READY) {
      throw new ServerFactoryError(
        `Cannot start server in state: ${this.state}`,
        'INVALID_STATE'
      );
    }

    try {
      this.setState(ServerState.RUNNING);

      // Create transport
      this.transport = this.createTransport();

      // Connect server to transport
      await this.server.connect(this.transport);

      // Register shutdown handlers
      this.registerShutdownHandlers();

      // Start health monitoring if configured
      if (this.config.healthCheckIntervalMs) {
        this.startHealthMonitoring();
      }

      this.emit('started');
      logger.info('MCP Server started successfully', {
        name: this.config.name,
        transport: this.config.transport,
      });
    } catch (error) {
      this.setState(ServerState.ERROR);
      this.emit('error', error);

      throw new ServerFactoryError(
        `Failed to start server: ${(error as Error).message}`,
        'START_ERROR',
        error
      );
    }
  }

  /**
   * Gracefully shutdown the server
   */
  public async shutdown(reason?: string): Promise<void> {
    if (this.state === ServerState.STOPPED || this.state === ServerState.SHUTTING_DOWN) {
      logger.warn('Server already stopped or shutting down');
      return;
    }

    this.setState(ServerState.SHUTTING_DOWN);
    this.emit('shutdown:started', { reason });

    logger.info('Shutting down MCP Server', { reason });

    try {
      // Stop health monitoring
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = undefined;
      }

      // Close server with timeout
      await Promise.race([
        this.closeServer(),
        this.shutdownTimeout(),
      ]);

      this.setState(ServerState.STOPPED);
      this.emit('shutdown:completed');

      logger.info('MCP Server shutdown complete');
    } catch (error) {
      this.setState(ServerState.ERROR);
      this.emit('shutdown:error', error);

      logger.error('Error during server shutdown', { error });
      throw error;
    }
  }

  /**
   * Close server connections
   */
  private async closeServer(): Promise<void> {
    // MCP SDK Server currently doesn't have a close method
    // This is a placeholder for future implementation
    if (this.transport && typeof (this.transport as { close?: () => Promise<void> }).close === 'function') {
      await (this.transport as { close: () => Promise<void> }).close();
    }
  }

  /**
   * Create shutdown timeout promise
   */
  private shutdownTimeout(): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new ServerFactoryError(
          `Shutdown timeout after ${this.config.gracefulShutdownTimeoutMs}ms`,
          'SHUTDOWN_TIMEOUT'
        ));
      }, this.config.gracefulShutdownTimeoutMs);
    });
  }

  /**
   * Register process signal handlers for graceful shutdown
   */
  private registerShutdownHandlers(): void {
    if (this.shutdownHandlersRegistered) {
      return;
    }

    const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];

    signals.forEach(signal => {
      process.on(signal, async () => {
        logger.info(`Received ${signal}, initiating graceful shutdown`);
        try {
          await this.shutdown(signal);
          process.exit(0);
        } catch (error) {
          logger.error('Shutdown failed', { error });
          process.exit(1);
        }
      });
    });

    // Handle uncaught errors
    process.on('uncaughtException', async (error) => {
      logger.error('Uncaught exception', { error });
      try {
        await this.shutdown('uncaughtException');
      } finally {
        process.exit(1);
      }
    });

    process.on('unhandledRejection', async (reason) => {
      logger.error('Unhandled rejection', { reason });
      try {
        await this.shutdown('unhandledRejection');
      } finally {
        process.exit(1);
      }
    });

    this.shutdownHandlersRegistered = true;
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    if (!this.config.healthCheckIntervalMs) {
      return;
    }

    this.healthCheckInterval = setInterval(() => {
      const healthy = this.isHealthy();

      this.emit('health:check', { healthy, state: this.state });

      if (!healthy && this.state !== ServerState.SHUTTING_DOWN) {
        logger.warn('Server health check failed', { state: this.state });
      }
    }, this.config.healthCheckIntervalMs);
  }

  /**
   * Get server metadata
   */
  public getMetadata() {
    return {
      name: this.config.name,
      version: this.config.version,
      description: this.config.description,
      state: this.state,
      capabilities: this.config.capabilities,
      transport: this.config.transport,
    };
  }
}
