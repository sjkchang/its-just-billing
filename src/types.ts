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

export const defaultLogger: BillingLogger = {
  debug: (msg, data) => console.debug(`[billing] ${msg}`, data ?? ""),
  info: (msg, data) => console.info(`[billing] ${msg}`, data ?? ""),
  warn: (msg, data) => console.warn(`[billing] ${msg}`, data ?? ""),
  error: (msg, data) => console.error(`[billing] ${msg}`, data ?? ""),
};
