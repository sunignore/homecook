import { describe, expect, it } from 'vitest';
import { accessCodeSchema, cloudContextSchema, generateAccessCode } from './cloudAuth';

describe('cloud authentication contracts', () => {
  it('requires long codes containing both letters and numbers', () => {
    expect(accessCodeSchema.safeParse('Short123').success).toBe(false);
    expect(accessCodeSchema.safeParse('onlyletterslong').success).toBe(false);
    expect(accessCodeSchema.safeParse('123456789012').success).toBe(false);
    expect(accessCodeSchema.safeParse('ValidCode2026').success).toBe(true);
    expect(accessCodeSchema.safeParse('Valid Code 2026').success).toBe(false);
  });

  it('generates a valid code without weak ambiguous characters', () => {
    for (let count = 0; count < 20; count++) {
      const code = generateAccessCode();
      expect(accessCodeSchema.parse(code)).toBe(code);
      expect(code).not.toMatch(/[0O1Il]/);
    }
  });

  it('rejects malformed or expanded authorization contexts', () => {
    const valid = {
      householdId: '11111111-1111-4111-8111-111111111111',
      role: 'husband',
      name: '우리집 식당',
      accessVersion: 1,
    };
    expect(cloudContextSchema.parse(valid)).toEqual(valid);
    expect(cloudContextSchema.safeParse({ ...valid, role: 'admin' }).success).toBe(false);
    expect(cloudContextSchema.safeParse({ ...valid, unexpected: true }).success).toBe(false);
  });
});
