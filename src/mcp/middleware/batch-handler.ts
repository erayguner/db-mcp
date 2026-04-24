import { logger } from '../../utils/logger.js';

/**
 * JSON-RPC 2.0 request object.
 */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: unknown;
}

/**
 * JSON-RPC 2.0 response object.
 */
export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * Result of validating an incoming JSON-RPC payload.
 */
export interface ValidationResult {
  valid: boolean;
  requests: JsonRpcRequest[];
  error?: string;
}

/**
 * Standard JSON-RPC error codes.
 */
export const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

/**
 * Type-guard that returns `true` when `body` is an array of JSON-RPC
 * request objects (batch request).
 */
export function isBatchRequest(body: unknown): body is JsonRpcRequest[] {
  return Array.isArray(body) && body.length > 0;
}

/**
 * Validate that `body` conforms to the JSON-RPC 2.0 specification.
 *
 * Accepts either a single request object or a batch array.
 * Returns the normalised array of requests and a validity flag.
 */
export function validateJsonRpc(body: unknown): ValidationResult {
  if (body === null || body === undefined) {
    return { valid: false, requests: [], error: 'Request body is empty' };
  }

  // Batch request
  if (Array.isArray(body)) {
    if (body.length === 0) {
      return { valid: false, requests: [], error: 'Empty batch request' };
    }

    const validated: JsonRpcRequest[] = [];
    for (let i = 0; i < body.length; i++) {
      const result = validateSingleRequest(body[i] as unknown);
      if (!result.valid) {
        return {
          valid: false,
          requests: [],
          error: `Invalid request at index ${i}: ${result.error}`,
        };
      }
      validated.push(result.request);
    }

    return { valid: true, requests: validated };
  }

  // Single request
  const result = validateSingleRequest(body);
  if (!result.valid) {
    return { valid: false, requests: [], error: result.error };
  }
  return { valid: true, requests: [result.request] };
}

/**
 * Validate a single (non-array) JSON-RPC request payload.
 */
function validateSingleRequest(
  obj: unknown
): { valid: true; request: JsonRpcRequest } | { valid: false; error: string; request?: undefined } {
  if (typeof obj !== 'object' || obj === null) {
    return { valid: false, error: 'Request must be a JSON object' };
  }

  const record = obj as Record<string, unknown>;

  if (record.jsonrpc !== '2.0') {
    return { valid: false, error: 'Missing or invalid "jsonrpc" field (must be "2.0")' };
  }

  if (typeof record.method !== 'string' || record.method.length === 0) {
    return { valid: false, error: 'Missing or invalid "method" field' };
  }

  if (record.id !== undefined && typeof record.id !== 'string' && typeof record.id !== 'number') {
    return { valid: false, error: '"id" must be a string or number if present' };
  }

  if (record.params !== undefined && typeof record.params !== 'object') {
    return { valid: false, error: '"params" must be an object or array if present' };
  }

  return {
    valid: true,
    request: {
      jsonrpc: '2.0',
      id: record.id,
      method: record.method,
      params: record.params,
    },
  };
}

/**
 * Process a batch of JSON-RPC requests in parallel using
 * `Promise.allSettled` so that a single failing request does not block
 * the others.
 *
 * @param requests - Array of validated JSON-RPC request objects.
 * @param handler  - Async function that processes a single request.
 * @returns An array of JSON-RPC responses in the same order.
 */
export async function processBatch(
  requests: JsonRpcRequest[],
  handler: (req: JsonRpcRequest) => Promise<JsonRpcResponse>
): Promise<JsonRpcResponse[]> {
  logger.debug('Processing JSON-RPC batch', { count: requests.length });

  const settled = await Promise.allSettled(requests.map((req) => handler(req)));

  return settled.map((outcome, index) => {
    if (outcome.status === 'fulfilled') {
      return outcome.value;
    }

    const request = requests[index];
    const reason =
      outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);

    logger.error('Batch request handler failed', {
      method: request.method,
      id: request.id,
      error: reason,
    });

    return {
      jsonrpc: '2.0' as const,
      id: request.id,
      error: {
        code: JSON_RPC_ERRORS.INTERNAL_ERROR,
        message: 'Internal error',
        data: reason,
      },
    };
  });
}
