Feature: PII redaction, column masking and k-anonymity
  As a data-governance boundary
  I must mask sensitive columns in query results, apply DLP to regulated
  datasets, and suppress cohorts that are too small to be anonymous.

  Scenario: Email values are partially masked
    Given a masking engine that masks column "email" as "partial" in dataset "customer_*" table "users"
    When a row with email "john@example.com" is masked for dataset "customer_prod" table "users"
    Then the masked email is "j***@example.com"

  Scenario: Phone numbers keep only the last four digits
    Given a masking engine that masks column "phone" as "partial" in dataset "customer_*" table "users"
    When a row with phone "5551234567" is masked for dataset "customer_prod" table "users"
    Then the masked phone is "****4567"

  Scenario: Sensitive identifiers are hashed
    Given a masking engine that masks column "ssn" as "hash" in dataset "customer_*" table "users"
    When a row with ssn "123-45-6789" is masked for dataset "customer_prod" table "users"
    Then the masked ssn is a 64-character hex hash

  Scenario: Masking is a no-op when disabled
    Given a masking engine that is disabled
    When a row with email "john@example.com" is masked for dataset "customer_prod" table "users"
    Then the email is returned unchanged

  Scenario: A regulated dataset gets full DLP
    Then DLP for a "regulated" dataset is "full"

  Scenario: A confidential dataset is inspected
    Then DLP for a "confidential" dataset is "inspect"

  Scenario: A public dataset skips DLP
    Then DLP for a "public" dataset is "skip"

  Scenario: k-anonymity suppresses cohorts below the threshold
    Given a cohort "age=20" with count 5
    And a cohort "age=30" with count 50
    When k-anonymity with k 10 in suppress mode is enforced
    Then only cohort "age=30" remains

  Scenario: k-anonymity rejects cohorts below the threshold in reject mode
    Given a cohort "age=20" with count 5
    And a cohort "age=30" with count 50
    Then enforcing k-anonymity with k 10 in reject mode throws
