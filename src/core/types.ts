/**
 * BillingLogger — injectable logger interface.
 *
 * Providers accept an optional logger. Default: console-based.
 * The API passes its own logger at initialization.
 */

export interface BillingLogger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

/**
 * KeyValueCache — optional cache interface (e.g. Redis).
 *
 * When provided, billing status and product lookups are cached automatically
 * with invalidation on mutations.
 */
export interface KeyValueCache {
  get(key: string): Promise<string | null | undefined>;
  set(key: string, value: string, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
}

export const defaultLogger: BillingLogger = {
  debug: (msg, data) => console.debug(`[billing] ${msg}`, data ?? ""),
  info: (msg, data) => console.info(`[billing] ${msg}`, data ?? ""),
  warn: (msg, data) => console.warn(`[billing] ${msg}`, data ?? ""),
  error: (msg, data) => console.error(`[billing] ${msg}`, data ?? ""),
};
