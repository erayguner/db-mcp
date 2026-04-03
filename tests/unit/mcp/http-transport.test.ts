import { describe, it, expect } from '@jest/globals';
import { HttpTransportConfigSchema } from '../../../src/mcp/transports/http-transport.js';

describe('HttpTransport', () => {
  describe('HttpTransportConfigSchema', () => {
    it('validates a valid HTTP config', () => {
      const config = {
        port: 8080,
        host: '0.0.0.0',
        basePath: '/mcp',
        corsOrigins: ['https://example.com'],
      };
      const result = HttpTransportConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('defaults port to 8080', () => {
      const result = HttpTransportConfigSchema.parse({});
      expect(result.port).toBe(8080);
    });

    it('defaults host to 0.0.0.0', () => {
      const result = HttpTransportConfigSchema.parse({});
      expect(result.host).toBe('0.0.0.0');
    });

    it('rejects port 0', () => {
      const result = HttpTransportConfigSchema.safeParse({ port: 0 });
      expect(result.success).toBe(false);
    });

    it('rejects port above 65535', () => {
      const result = HttpTransportConfigSchema.safeParse({ port: 70000 });
      expect(result.success).toBe(false);
    });
  });
});
