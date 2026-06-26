Feature: Request authorization (OIDC and Workload Identity Federation)
  As the MCP server boundary
  I must reject tokens that are missing, malformed, expired, or untrusted
  and only authenticate principals presenting valid credentials.

  Scenario: A request with no token is rejected
    Given an OIDC authenticator for issuer "https://accounts.google.com" and audience "mcp-server"
    When an empty bearer token is authenticated
    Then OIDC authentication fails with code "MISSING_TOKEN"

  Scenario: An OIDC authenticator refuses a non-HTTPS issuer
    When an OIDC authenticator is configured with issuer "http://insecure.example.com"
    Then configuration fails because the issuer must use HTTPS

  Scenario: A valid bearer token authenticates through the middleware
    Given an auth middleware that requires authentication
    And the underlying authenticator accepts tokens as "alice@acme.com"
    When a request with authorization header "Bearer good-token" is processed
    Then the request is authenticated as "alice@acme.com"

  Scenario: An invalid bearer token is rejected by the middleware
    Given an auth middleware that requires authentication
    And the underlying authenticator rejects tokens as invalid
    When a request with authorization header "Bearer bad-token" is processed
    Then the request is not authenticated
    And the auth error code is "INVALID_TOKEN"

  Scenario: A missing token is rejected when auth is required
    Given an auth middleware that requires authentication
    When a request with no authorization header is processed
    Then the request is not authenticated
    And the auth error code is "MISSING_TOKEN"

  Scenario: A missing token is allowed when auth is not required
    Given an auth middleware that does not require authentication
    When a request with no authorization header is processed
    Then the request is authenticated

  Scenario: WIF rejects an expired OIDC token
    Given a WIF authenticator for project "test-project"
    When an expired OIDC token is exchanged
    Then the WIF exchange fails mentioning "Token has expired"

  Scenario: WIF rejects a token from an untrusted issuer
    Given a WIF authenticator that only trusts issuer "https://trusted.example.com"
    When an OIDC token from issuer "https://evil.example.com" is exchanged
    Then the WIF exchange fails mentioning "Invalid issuer"

  Scenario: WIF rejects a token with an unverified email
    Given a WIF authenticator that requires verified email
    When an OIDC token with an unverified email is exchanged
    Then the WIF exchange fails mentioning "Email not verified"

  Scenario: WIF refuses impersonation when it is disabled
    Given a WIF authenticator with impersonation disabled
    When impersonation of "evil-sa@test-project.iam.gserviceaccount.com" is attempted
    Then the WIF exchange fails mentioning "impersonation is disabled"

  Scenario: WIF builds the correct federation resource names
    Given a WIF authenticator for project "test-project" with pool "my-pool" and provider "my-provider"
    Then the pool resource name is "projects/test-project/locations/global/workloadIdentityPools/my-pool"
    And the provider resource name ends with "/providers/my-provider"
