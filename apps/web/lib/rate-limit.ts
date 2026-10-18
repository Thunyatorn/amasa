export function createRateLimiter({ max, windowMs, now = Date.now }: {
  max: number; windowMs: number; now?: () => number;
}): { allow(key: string): boolean } {
  const calls = new Map<string, number[]>();
  return {
    allow(key) {
      const time = now();
      for (const [id, timestamps] of calls) {
        const active = timestamps.filter((timestamp) => timestamp > time - windowMs);
        if (active.length) calls.set(id, active);
        else calls.delete(id);
      }
      const active = calls.get(key) ?? [];
      if (active.length >= max) return false;
      active.push(time);
      calls.set(key, active);
      return true;
    },
  };
}
