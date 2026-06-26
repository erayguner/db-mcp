Feature: Session kill-switch
  As an operator
  I must be able to halt a runaway or suspicious session immediately
  and resume it later, while never affecting unrelated sessions.

  Scenario: A halted session blocks further operations
    Given a kill switch
    When session "sess-1" is halted for reason "suspicious activity" by "ops@example.com"
    Then session "sess-1" is reported as halted
    And enforcing session "sess-1" throws a session-halted error

  Scenario: A resumed session is allowed again
    Given a kill switch
    And session "sess-1" is halted for reason "investigation" by "ops@example.com"
    When session "sess-1" is resumed by "ops@example.com"
    Then session "sess-1" is not halted
    And enforcing session "sess-1" does not throw

  Scenario: An unrelated session is never blocked
    Given a kill switch
    And session "sess-1" is halted for reason "investigation" by "ops@example.com"
    Then enforcing session "sess-2" does not throw

  Scenario: The halt reason is recorded
    Given a kill switch
    And session "sess-1" is halted for reason "data exfiltration attempt" by "ops@example.com"
    Then the halt reason for session "sess-1" is "data exfiltration attempt"
