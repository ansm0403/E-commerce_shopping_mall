/** Ordinary-account stub for service unit tests; policy security tests use real methods. */
export const mockDemoPolicy = () => ({
  user: async () => ({ isDemo: false }),
  forbidDemo: async () => undefined,
  assertOrderActor: async () => undefined,
  assertInquiryActor: async () => undefined,
  forbidFixtureOrder: async () => undefined,
  isFixtureOrder: async () => false,
  createDemoInquiry: async () => null,
  approvedSeller: async () => ({ id: 1 }),
  catalogSeller: async () => ({ id: 1 }),
  assertTestDeliveryActor: async () => undefined,
  canTestDeliver: async () => true,
});
