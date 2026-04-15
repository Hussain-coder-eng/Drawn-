/**
 * Utility to measure and log API latency.
 */
export const measureLatency = async <T>(
  name: string,
  fn: () => Promise<T>,
  options: { silent?: boolean } = {}
): Promise<{ data: T; latencyMs: number }> => {
  const start = performance.now();
  try {
    const data = await fn();
    const end = performance.now();
    const latencyMs = end - start;
    if (!options.silent) {
      console.log(`[LATENCY] ${name}: ${latencyMs.toFixed(2)}ms`);
    }
    return { data, latencyMs };
  } catch (error) {
    const end = performance.now();
    if (!options.silent) {
      console.error(`[LATENCY ERROR] ${name} failed after ${(end - start).toFixed(2)}ms`);
    }
    throw error;
  }
};
