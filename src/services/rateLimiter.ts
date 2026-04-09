export class RateLimiter {
  private maxRequests: number;
  private windowMs: number;
  private requests: number[];

  constructor({ maxRequests, windowMs }: { maxRequests: number; windowMs: number }) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.requests = [];
  }

  async check(): Promise<void> {
    const now = Date.now();
    // Remove requests outside the current window
    this.requests = this.requests.filter(timestamp => now - timestamp < this.windowMs);

    if (this.requests.length >= this.maxRequests) {
      const waitTime = Math.ceil((this.windowMs - (now - this.requests[0])) / 1000);
      throw new Error(`Rate limit exceeded. Please wait ${waitTime} seconds before trying again.`);
    }

    this.requests.push(now);
  }
}
