import { describe, expect, it } from 'vitest';
import { inQuietHours } from '@matta/core';
import { tenAmJstOffset } from './seed';

describe('tenAmJstOffset', () => {
  it('puts the sandbox clock at 10:00 JST on the same JST day, at any real time', () => {
    for (const iso of ['2026-10-13T00:30:00Z', '2026-10-13T14:59:00Z', '2026-10-13T15:01:00Z', '2026-10-13T22:00:00Z']) {
      const now = new Date(iso);
      const sim = new Date(now.getTime() + tenAmJstOffset(now));
      expect(sim.toISOString().slice(11, 16)).toBe('01:00'); // 10:00 JST
      expect(new Date(sim.getTime() + 9 * 3600_000).toISOString().slice(0, 10)).toBe(new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10));
      expect(inQuietHours({ start: '22:00', end: '06:00' }, sim)).toBe(false);
    }
  });
});
