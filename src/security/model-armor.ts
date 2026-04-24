import { GoogleAuth } from 'google-auth-library';
import { logger } from '../utils/logger.js';

/**
 * Model Armor pre-flight screening for MCP tool inputs.
 *
 * Screens user-supplied text (SQL, natural-language prompts) against a
 * Model Armor template before it reaches BigQuery. Integrates as a thin
 * provider so tests and offline envs can opt into a no-op.
 */

export type ModelArmorVerdict = 'allow' | 'block';

export interface ModelArmorResult {
  verdict: ModelArmorVerdict;
  reason?: string;
  matchedFilters?: string[];
  /** True when the upstream call failed and we fell back to heuristics. */
  degraded?: boolean;
}

export interface ModelArmorProvider {
  screenUserPrompt(text: string, metadata?: { tenantId?: string; tool?: string }): Promise<ModelArmorResult>;
}

/** Null provider for dev/tests — always allows. */
export class NoopModelArmorProvider implements ModelArmorProvider {
  screenUserPrompt(): Promise<ModelArmorResult> {
    return Promise.resolve({ verdict: 'allow' });
  }
}

/**
 * Heuristic provider — lightweight pattern-based check used as a fallback
 * when Model Armor is unreachable, or as a cheap default without GCP wiring.
 * Catches the common prompt-injection and destructive-SQL patterns the
 * existing security middleware already flags, but surfaces them through
 * the ModelArmor pipeline so downstream logic is uniform.
 */
export class HeuristicModelArmorProvider implements ModelArmorProvider {
  private static readonly BLOCKED_PATTERNS: Array<{ pattern: RegExp; filter: string }> = [
    { pattern: /ignore\s+(all\s+)?previous\s+instructions/i, filter: 'prompt_injection' },
    { pattern: /disregard\s+(above|prior)/i, filter: 'prompt_injection' },
    { pattern: /(^|\s)system\s*:\s*/i, filter: 'role_escalation' },
    { pattern: /\bDROP\s+TABLE\b/i, filter: 'destructive_sql' },
    { pattern: /\bTRUNCATE\s+TABLE\b/i, filter: 'destructive_sql' },
    { pattern: /\bGRANT\s+ALL\b/i, filter: 'privilege_escalation' },
  ];

  screenUserPrompt(text: string): Promise<ModelArmorResult> {
    const matched: string[] = [];
    for (const { pattern, filter } of HeuristicModelArmorProvider.BLOCKED_PATTERNS) {
      if (pattern.test(text)) matched.push(filter);
    }
    if (matched.length === 0) return Promise.resolve({ verdict: 'allow' });
    return Promise.resolve({
      verdict: 'block',
      reason: `Heuristic screening matched: ${matched.join(', ')}`,
      matchedFilters: matched,
    });
  }
}

interface HttpModelArmorOptions {
  projectId: string;
  location: string;
  templateId: string;
  fallback?: ModelArmorProvider;
  endpoint?: string;
}

/**
 * Calls the Model Armor REST API using ADC from google-auth-library.
 * Endpoint shape: https://modelarmor.{location}.rep.googleapis.com/v1/
 *                 projects/{project}/locations/{location}/templates/{template}:sanitizeUserPrompt
 */
export class HttpModelArmorProvider implements ModelArmorProvider {
  private readonly auth: GoogleAuth;
  private readonly resource: string;
  private readonly endpoint: string;
  private readonly fallback: ModelArmorProvider;

  constructor(opts: HttpModelArmorOptions) {
    this.auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    this.resource = `projects/${opts.projectId}/locations/${opts.location}/templates/${opts.templateId}`;
    this.endpoint = opts.endpoint
      ?? `https://modelarmor.${opts.location}.rep.googleapis.com`;
    this.fallback = opts.fallback ?? new HeuristicModelArmorProvider();
  }

  async screenUserPrompt(text: string, metadata?: { tenantId?: string; tool?: string }): Promise<ModelArmorResult> {
    try {
      const client = await this.auth.getClient();
      const url = `${this.endpoint}/v1/${this.resource}:sanitizeUserPrompt`;
      const response = await client.request<ModelArmorApiResponse>({
        url,
        method: 'POST',
        data: { userPromptData: { text } },
      });

      return interpretSanitizeResponse(response.data, metadata);
    } catch (err) {
      logger.warn('Model Armor upstream failed; falling back to heuristics', {
        error: err instanceof Error ? err.message : String(err),
        ...metadata,
      });
      const fallbackResult = await this.fallback.screenUserPrompt(text, metadata);
      return { ...fallbackResult, degraded: true };
    }
  }
}

/** Shape of Model Armor's sanitizeUserPrompt response (minimal subset). */
interface ModelArmorApiResponse {
  sanitizationResult?: {
    filterMatchState?: 'NO_MATCH_FOUND' | 'MATCH_FOUND';
    filterResults?: Record<string, { matchState?: 'NO_MATCH_FOUND' | 'MATCH_FOUND' }>;
    invocationResult?: 'SUCCESS' | 'PARTIAL' | 'FAILURE';
  };
}

function interpretSanitizeResponse(
  response: ModelArmorApiResponse,
  metadata?: { tenantId?: string; tool?: string },
): ModelArmorResult {
  const result = response.sanitizationResult;
  if (!result || result.filterMatchState !== 'MATCH_FOUND') {
    return { verdict: 'allow' };
  }
  const matched = Object.entries(result.filterResults ?? {})
    .filter(([, v]) => v.matchState === 'MATCH_FOUND')
    .map(([k]) => k);
  logger.warn('Model Armor blocked user prompt', { matchedFilters: matched, ...metadata });
  return {
    verdict: 'block',
    reason: 'Model Armor flagged unsafe content',
    matchedFilters: matched,
  };
}

/**
 * Factory — builds a provider from environment config.
 * MODEL_ARMOR_TEMPLATE=projects/{p}/locations/{l}/templates/{t} enables live mode.
 */
export function createModelArmorProvider(env: NodeJS.ProcessEnv = process.env): ModelArmorProvider {
  const template = env.MODEL_ARMOR_TEMPLATE;
  if (!template) return new NoopModelArmorProvider();

  const match = /^projects\/([^/]+)\/locations\/([^/]+)\/templates\/([^/]+)$/.exec(template);
  if (!match) {
    logger.error('Invalid MODEL_ARMOR_TEMPLATE; expected projects/{p}/locations/{l}/templates/{t}', { template });
    return new HeuristicModelArmorProvider();
  }
  const [, projectId, location, templateId] = match;
  return new HttpModelArmorProvider({ projectId, location, templateId });
}
