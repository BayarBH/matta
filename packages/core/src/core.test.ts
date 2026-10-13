import { describe, expect, it } from 'vitest';
import { UserClaims, modelId, s2sBypassAllowed } from './index';

describe('UserClaims', () => {
  it('requires a sandbox for customers and contacts', () => {
    expect(UserClaims.safeParse({ role: 'customer', sandboxId: 'sandbox-1' }).success).toBe(true);
    expect(UserClaims.safeParse({ role: 'contact' }).success).toBe(false);
    expect(UserClaims.safeParse({ role: 'operator' }).success).toBe(true);
    expect(UserClaims.safeParse({ role: 'admin', sandboxId: 'sandbox-1' }).success).toBe(false);
  });
});

describe('modelId', () => {
  it('rejects Gemini 2.5', () => {
    expect(modelId.safeParse('gemini-2.5-flash').success).toBe(false);
    expect(modelId.safeParse('gemini-3-flash').success).toBe(true);
  });
});

describe('s2sBypassAllowed', () => {
  it('is never allowed in production', () => {
    expect(s2sBypassAllowed('production', true)).toBe(false);
    expect(s2sBypassAllowed('development', true)).toBe(true);
    expect(s2sBypassAllowed('development', false)).toBe(false);
  });
});
