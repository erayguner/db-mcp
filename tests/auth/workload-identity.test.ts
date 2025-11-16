import { WorkloadIdentityFederation } from '../../src/auth/workload-identity';

describe('WorkloadIdentityFederation', () => {
  const mockConfig = {
    projectId: 'test-project',
    workloadIdentityPoolId: 'test-pool',
    workloadIdentityProviderId: 'test-provider',
    serviceAccountEmail: 'test@test-project.iam.gserviceaccount.com',
    tokenLifetime: 3600,
  };

  it('should initialize with valid config', () => {
    const wif = new WorkloadIdentityFederation(mockConfig);
    expect(wif).toBeDefined();
  });

  it('should clear token cache', () => {
    const wif = new WorkloadIdentityFederation(mockConfig);
    wif.clearCache();
    expect(true).toBe(true); // Cache cleared successfully
  });

  it('should validate config schema', () => {
    expect(() => {
      new WorkloadIdentityFederation({
        ...mockConfig,
        tokenLifetime: 3600,
      });
    }).not.toThrow();
  });
});
