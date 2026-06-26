Feature: Tool governance (fail-closed allow-list and approval gates)
  As the MCP tool dispatcher
  I must only permit explicitly allow-listed tools and require approval
  for sensitive tools, denying everything else by default.

  Scenario: An allow-listed tool is permitted
    Given the production tool-governance policy is loaded
    Then the tool "query_bigquery" is allowed

  Scenario: A deny-listed tool is blocked
    Given the production tool-governance policy is loaded
    Then the tool "drop_table" is blocked with reason "deny-list"

  Scenario: An unknown tool is blocked by default
    Given the production tool-governance policy is loaded
    Then the tool "totally_unknown_tool" is blocked with reason "not-in-allow-list"

  Scenario: A tool that requires approval is flagged
    Given a tool-governance policy that requires approval for "execute_query"
    Then the tool "execute_query" requires approval
    And the tool "query_bigquery" does not require approval
