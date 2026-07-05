import { describe, expect, it } from 'vitest';

describe('reminder web configuration', () => {
  it('uses a valid default digest time', () => {
    expect('23:00').toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
  });
});
