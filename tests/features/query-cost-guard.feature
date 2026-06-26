Feature: Query cost guard (cost elicitation gate)
  As the BigQuery query tool
  I must estimate scan cost with a dry run and require explicit confirmation
  before executing queries that exceed the configured byte threshold.

  Scenario: A query under the cost threshold runs without confirmation
    Given the cost elicitation gate is enabled with a threshold of 1000 bytes
    And a dry run that reports 500 bytes
    When the query "SELECT 1" is executed without cost confirmation
    Then the query is executed
    And no confirmation is required

  Scenario: A query over the cost threshold requires confirmation
    Given the cost elicitation gate is enabled with a threshold of 1000 bytes
    And a dry run that reports 50000 bytes
    When the query "SELECT * FROM big_table" is executed without cost confirmation
    Then the query is not executed
    And a cost confirmation is required
    And the confirmation reports 50000 estimated bytes

  Scenario: A confirmed query runs even above the threshold
    Given the cost elicitation gate is enabled with a threshold of 1000 bytes
    And a dry run that reports 50000 bytes
    When the query "SELECT 1" is executed with cost confirmation
    Then the query is executed

  Scenario: The cost gate can be disabled
    Given the cost elicitation gate is disabled
    When the query "SELECT 1" is executed without cost confirmation
    Then the query is executed
    And no dry run is performed
