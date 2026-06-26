import { loadFeature, defineFeature } from 'jest-cucumber';
import { join } from 'node:path';
import {
  loadPolicies,
  isToolAllowed,
  requiresApproval,
  type ToolGovernance,
} from '../../src/governance/policy.js';

const feature = loadFeature('./tool-governance.feature', { loadRelativePath: true });

function makeGovernance(overrides: Partial<ToolGovernance> = {}): ToolGovernance {
  return {
    $schema: 'db-mcp/tool-governance.v1',
    version: '1.0.0',
    defaultAllow: false,
    allowList: ['query_bigquery', 'execute_query'],
    denyList: ['drop_table'],
    requireApproval: [],
    categories: {},
    budgets: {
      maxTotalCalls: 100,
      maxCallsPerTool: {},
      maxRuntimeMs: 60000,
      maxParallelism: 4,
      separationOfDuties: [],
    },
    argumentGates: [],
    ...overrides,
  } as ToolGovernance;
}

defineFeature(feature, (test) => {
  let gov: ToolGovernance;

  const givenProductionPolicy = (given: (s: string, fn: () => Promise<void>) => void) =>
    given('the production tool-governance policy is loaded', async () => {
      const policies = await loadPolicies(join(process.cwd(), 'config', 'policies'));
      gov = policies.toolGovernance;
    });

  test('An allow-listed tool is permitted', ({ given, then }) => {
    givenProductionPolicy(given);
    then(/^the tool "(.*)" is allowed$/, (tool) => {
      expect(isToolAllowed(gov, tool).allowed).toBe(true);
    });
  });

  test('A deny-listed tool is blocked', ({ given, then }) => {
    givenProductionPolicy(given);
    then(/^the tool "(.*)" is blocked with reason "(.*)"$/, (tool, reason) => {
      const result = isToolAllowed(gov, tool);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe(reason);
    });
  });

  test('An unknown tool is blocked by default', ({ given, then }) => {
    givenProductionPolicy(given);
    then(/^the tool "(.*)" is blocked with reason "(.*)"$/, (tool, reason) => {
      const result = isToolAllowed(gov, tool);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe(reason);
    });
  });

  test('A tool that requires approval is flagged', ({ given, then, and }) => {
    given(/^a tool-governance policy that requires approval for "(.*)"$/, (tool) => {
      gov = makeGovernance({ requireApproval: [tool] });
    });
    then(/^the tool "(.*)" requires approval$/, (tool) => {
      expect(requiresApproval(gov, tool)).toBe(true);
    });
    and(/^the tool "(.*)" does not require approval$/, (tool) => {
      expect(requiresApproval(gov, tool)).toBe(false);
    });
  });
});
