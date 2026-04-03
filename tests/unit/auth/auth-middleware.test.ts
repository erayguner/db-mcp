import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { z } from 'zod';

// Mock the telemetry metrics module before importing AuthMiddleware
jest.unstable_mockModule('../../../src/telemetry/metrics', () => ({
  recordAuthAttempt: jest.fn(),
  recordRequest: jest.fn(),
  recordError: jest.fn(),
  recordQueryLatency: jest.fn(),
  recordBigQueryBytes: jest.fn(),
  trackConnection: jest.fn(),
  initializeMetrics: jest.fn(),
  getMetrics: jest.fn(),
  shutdownMetrics: jest.fn(),
}));

// Mock the OIDC authenticator module before importing AuthMiddleware
const mockAuthenticate = jest.fn();

// Use a real Zod schema so AuthMiddlewareConfigSchema.parse() works correctly
const MockOIDCConfigSchema = z.object({
  issuer: z.string(),
  audience: z.string(),
  jwksUri: z.string().optional(),
  requiredScopes: z.array(z.string()).default([]),
  clockToleranceSec: z.number().default(30),
});

jest.unstable_mockModule('../../../src/auth/oidc-authenticator', () => ({
  OIDCAuthenticator: jest.fn().mockImplementation(() => ({
    authenticate: mockAuthenticate,
  })),
  OIDCConfigSchema: MockOIDCConfigSchema,
  OIDCAuthenticationError: class extends Error {
    code: string;
    statusCode: number;
    constructor(msg: string, code: string, status = 401) {
      super(msg);
      this.name = 'OIDCAuthenticationError';
      this.code = code;
      this.statusCode = status;
    }
  },
}));

// Dynamic import after mock setup
const { AuthMiddleware } = await import('../../../src/auth/auth-middleware');

describe('AuthMiddleware', () => {
  let middleware: InstanceType<typeof AuthMiddleware>;

  beforeEach(() => {
    jest.clearAllMocks();
    middleware = new AuthMiddleware({
      oidc: {
        issuer: 'https://accounts.google.com',
        audience: 'test-server',
      },
      bypassTools: [],
      requireAuth: true,
    });
  });

  it('rejects request without authorization header when requireAuth is true', async () => {
    const result = await middleware.authenticate({});
    expect(result.authenticated).toBe(false);
    expect(result.error).toContain('No authorization token');
  });

  it('passes through when requireAuth is false and no token', async () => {
    middleware = new AuthMiddleware({
      oidc: {
        issuer: 'https://accounts.google.com',
        audience: 'test-server',
      },
      bypassTools: [],
      requireAuth: false,
    });
    const result = await middleware.authenticate({});
    expect(result.authenticated).toBe(true);
    expect(result.principal).toBeUndefined();
  });

  it('authenticates valid token and returns principal', async () => {
    mockAuthenticate.mockResolvedValue({
      subject: 'user-123',
      email: 'user@example.com',
      issuer: 'https://accounts.google.com',
      audience: 'test-server',
      scopes: ['bigquery.readonly'],
      claims: {},
      authenticatedAt: new Date(),
    });

    const result = await middleware.authenticate({
      authorization: 'Bearer valid-token',
    });
    expect(result.authenticated).toBe(true);
    expect(result.principal?.email).toBe('user@example.com');
  });

  it('returns error when authentication fails', async () => {
    const { OIDCAuthenticationError } = await import('../../../src/auth/oidc-authenticator');
    mockAuthenticate.mockRejectedValue(
      new OIDCAuthenticationError('Invalid token', 'INVALID_TOKEN')
    );

    const result = await middleware.authenticate({
      authorization: 'Bearer bad-token',
    });
    expect(result.authenticated).toBe(false);
    expect(result.errorCode).toBe('INVALID_TOKEN');
  });

  it('identifies bypassed tools', () => {
    middleware = new AuthMiddleware({
      oidc: {
        issuer: 'https://accounts.google.com',
        audience: 'test-server',
      },
      bypassTools: ['list_tools'],
      requireAuth: true,
    });
    expect(middleware.isToolBypassed('list_tools')).toBe(true);
    expect(middleware.isToolBypassed('query_bigquery')).toBe(false);
  });
});
