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
  screenUserPrompt(
    text: string,
    metadata?: { tenantId?: string; tool?: string }
  ): Promise<ModelArmorResult>;
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
  /**
   * When 'fail-closed', an unreachable API blocks the request.
   * When 'fail-open' (default), a warning is logged and the request proceeds.
   */
  onError?: 'fail-open' | 'fail-closed';
  fallback?: ModelArmorProvider;
  endpoint?: string;
}

/**
 * Calls the Google Cloud Model Armor REST API using ADC from google-auth-library.
 *
 * Endpoint: https://modelarmor.{location}.rep.googleapis.com/v1/
 *           projects/{project}/locations/{location}/templates/{template}:sanitizeUserPrompt
 *
 * Graceful degradation is controlled by `onError`:
 *   - 'fail-open'  (default) — logs a warning and allows the request through.
 *   - 'fail-closed'          — returns a block verdict so the request is denied.
 *
 * Human follow-up: the Model Armor template must be created in GCP before
 * enabling MODEL_ARMOR_ENABLED=true.  Template format:
 *   projects/{project}/locations/{location}/templates/{template}
 */
export class HttpModelArmorProvider implements ModelArmorProvider {
  private readonly auth: GoogleAuth;
  private readonly resource: string;
  private readonly endpoint: string;
  private readonly onError: 'fail-open' | 'fail-closed';
  private readonly fallback: ModelArmorProvider;

  constructor(opts: HttpModelArmorOptions) {
    this.auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    this.resource = `projects/${opts.projectId}/locations/${opts.location}/templates/${opts.templateId}`;
    this.endpoint = opts.endpoint ?? `https://modelarmor.${opts.location}.rep.googleapis.com`;
    this.onError = opts.onError ?? 'fail-open';
    this.fallback = opts.fallback ?? new HeuristicModelArmorProvider();
  }

  async screenUserPrompt(
    text: string,
    metadata?: { tenantId?: string; tool?: string }
  ): Promise<ModelArmorResult> {
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
      const errMsg = err instanceof Error ? err.message : String(err);
      if (this.onError === 'fail-closed') {
        logger.error('Model Armor upstream failed; fail-closed — blocking request', {
          error: errMsg,
          ...metadata,
        });
        return {
          verdict: 'block',
          reason: 'Model Armor API unreachable (fail-closed policy)',
          degraded: true,
        };
      }
      // fail-open: log warning, apply heuristic fallback, mark as degraded
      logger.warn('Model Armor upstream failed; fail-open — falling back to heuristics', {
        error: errMsg,
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
  metadata?: { tenantId?: string; tool?: string }
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
 *
 * Env vars (all defined in src/config/environment.ts):
 *   MODEL_ARMOR_ENABLED   — must be 'true' to activate live API screening
 *   MODEL_ARMOR_TEMPLATE  — full resource name (projects/…/locations/…/templates/…)
 *   MODEL_ARMOR_LOCATION  — region override (default: europe-west2)
 *   MODEL_ARMOR_ON_ERROR  — 'fail-open' (default) | 'fail-closed'
 *
 * HUMAN FOLLOW-UP: Create the Model Armor template in GCP before setting
 * MODEL_ARMOR_ENABLED=true.  See:
 * https://cloud.google.com/security/ai/docs/model-armor/create-templates
 */
export function createModelArmorProvider(env: NodeJS.ProcessEnv = process.env): ModelArmorProvider {
  const enabled = (env.MODEL_ARMOR_ENABLED ?? '').toLowerCase() === 'true';
  if (!enabled) {
    // Feature flag off — use heuristic screen so offline envs still get
    // basic protection without any GCP dependency.
    return new HeuristicModelArmorProvider();
  }

  const template = env.MODEL_ARMOR_TEMPLATE;
  if (!template) {
    logger.error(
      'MODEL_ARMOR_ENABLED=true but MODEL_ARMOR_TEMPLATE is not set; ' +
        'falling back to heuristics'
    );
    return new HeuristicModelArmorProvider();
  }

  const match = /^projects\/([^/]+)\/locations\/([^/]+)\/templates\/([^/]+)$/.exec(template);
  if (!match) {
    logger.error(
      'Invalid MODEL_ARMOR_TEMPLATE; expected projects/{p}/locations/{l}/templates/{t}',
      { template }
    );
    return new HeuristicModelArmorProvider();
  }

  const [, projectId, location, templateId] = match;
  const onError = (env.MODEL_ARMOR_ON_ERROR ?? 'fail-open') as 'fail-open' | 'fail-closed';

  logger.info('Model Armor enabled', { projectId, location, templateId, onError });
  return new HttpModelArmorProvider({ projectId, location, templateId, onError });
}
