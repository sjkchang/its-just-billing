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
  /** Atomic set-if-not-exists. Returns true if the key was set. */
  setIfAbsent?(key: string, value: string, ttl?: number): Promise<boolean>;
}

/**
 * BillingContext — shared dependencies passed to all services.
 */
export interface BillingContext {
  adapter: import("../repositories/types").BillingRepositories;
  providers: import("../providers/types").BillingProviders;
  providerType: import("./entities").BillingProviderType;
  config: import("./config").BillingAppConfig;
  logger: BillingLogger;
  cache?: KeyValueCache;
}

// ============================================================================
// ID Generation
// ============================================================================

import { nanoid } from "nanoid";

/** Generate a unique ID. Central point for changing ID strategy. */
export const createId: () => string = nanoid;

export const defaultLogger: BillingLogger = {
  debug: (msg, data) => console.debug(`[billing] ${msg}`, data ?? ""),
  info: (msg, data) => console.info(`[billing] ${msg}`, data ?? ""),
  warn: (msg, data) => console.warn(`[billing] ${msg}`, data ?? ""),
  error: (msg, data) => console.error(`[billing] ${msg}`, data ?? ""),
};
