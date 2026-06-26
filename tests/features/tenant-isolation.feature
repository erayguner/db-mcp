Feature: Multi-tenant dataset isolation
  As a multi-tenant BigQuery MCP server
  I must ensure that each tenant can only reach datasets it is authorized for
  so that one tenant can never read or write another tenant's data.

  Scenario: A tenant can access a dataset on its allow-list
    Given a tenant "acme" in project "acme-prod" that allows dataset "analytics" with write mode "blocked"
    Then tenant "acme" is allowed to access dataset "analytics"

  Scenario: A tenant cannot access a dataset that is not on its allow-list
    Given a tenant "acme" in project "acme-prod" that allows dataset "analytics" with write mode "blocked"
    Then tenant "acme" is denied access to dataset "globex_secrets"

  Scenario: A cross-tenant query is rejected with a reason
    Given a tenant "acme" in project "acme-prod" that allows dataset "analytics" with write mode "blocked"
    When tenant "acme" runs the query "SELECT * FROM `globex-prod.globex_secrets.customers`"
    Then the query is denied
    And the denial reason mentions "not authorized to access datasets"

  Scenario: A tenant can query its own allowed dataset
    Given a tenant "acme" in project "acme-prod" that allows dataset "analytics" with write mode "blocked"
    When tenant "acme" runs the query "SELECT * FROM `acme-prod.analytics.events`"
    Then the query is allowed

  Scenario: A write-blocked tenant cannot run DML
    Given a tenant "acme" in project "acme-prod" that allows dataset "analytics" with write mode "blocked"
    When tenant "acme" runs the query "INSERT INTO `acme-prod.analytics.events` (id) VALUES (1)"
    Then the query is denied
    And the denial reason mentions "write"

  Scenario: A write-enabled tenant can run DML on its own dataset
    Given a tenant "globex" in project "globex-prod" that allows dataset "globex_analytics" with write mode "allowed"
    When tenant "globex" runs the query "INSERT INTO `globex-prod.globex_analytics.events` (id) VALUES (1)"
    Then the query is allowed

  Scenario: An authenticated principal resolves to its own tenant context
    Given a tenant "acme" in project "acme-prod" that allows dataset "analytics" with write mode "blocked"
    And the tenant "acme" recognises subjects matching ".*@acme\.com$"
    When a principal with email "alice@acme.com" requests a tenant context
    Then the resolved tenant context is for tenant "acme"
