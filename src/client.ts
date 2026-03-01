/**
 * Frontend billing client — lightweight fetch-based client with typed methods.
 *
 * @example
 * ```ts
 * import { createBillingClient } from "its-just-billing/client";
 * const billing = createBillingClient({ basePath: "/api/v1/billing" });
 * const status = await billing.getStatus();
 * ```
 */

// ============================================================================
// Response types (match route response shapes)
// ============================================================================

export interface BillingStatusResponse {
  entitlements: string[];
  productId: string | null;
  productName: string | null;
  productDescription: string | null;
  subscription: {
    id: string;
    status: string;
    currentPeriodEnd: string | null;
    pendingCancellation: boolean;
  } | null;
  statusMessage: string;
  metadata: Record<string, string> | null;
}

export interface ProductResponse {
  id: string;
  name: string;
  description: string | null;
  prices: {
    id: string;
    amount: number;
    currency: string;
    interval: "month" | "year" | "one_time";
  }[];
  metadata?: Record<string, string>;
}

export interface ProductsListResponse {
  products: ProductResponse[];
}

export interface CheckoutResponse {
  checkoutUrl: string;
}

export interface PortalResponse {
  portalUrl: string;
}

// ============================================================================
// Error
// ============================================================================

export class BillingClientError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown
  ) {
    super(message);
    this.name = "BillingClientError";
  }
}

// ============================================================================
// Client
// ============================================================================

export interface BillingClientOptions {
  basePath?: string;
}

export interface BillingClient {
  getStatus(): Promise<BillingStatusResponse>;
  getProducts(): Promise<ProductsListResponse>;
  checkout(input: {
    productId: string;
    successUrl: string;
    cancelUrl?: string;
  }): Promise<CheckoutResponse>;
  createPortal(returnUrl: string): Promise<PortalResponse>;
  sync(): Promise<BillingStatusResponse>;
  cancelSubscription(id: string): Promise<BillingStatusResponse>;
  resumeSubscription(id: string): Promise<BillingStatusResponse>;
  changeSubscription(id: string, productId: string): Promise<BillingStatusResponse>;
}

export function createBillingClient(options?: BillingClientOptions): BillingClient {
  const basePath = options?.basePath ?? "/api/v1/billing";

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${basePath}${path}`;
    const init: RequestInit = {
      method,
      credentials: "include",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    };

    const res = await fetch(url, init);

    if (!res.ok) {
      let errorBody: unknown;
      try {
        errorBody = await res.json();
      } catch {
        // ignore
      }
      throw new BillingClientError(`Billing API error: ${res.status}`, res.status, errorBody);
    }

    return res.json() as Promise<T>;
  }

  return {
    getStatus: () => request<BillingStatusResponse>("GET", "/status"),
    getProducts: () => request<ProductsListResponse>("GET", "/products"),
    checkout: (input) => request<CheckoutResponse>("POST", "/checkout", input),
    createPortal: (returnUrl) => request<PortalResponse>("POST", "/portal", { returnUrl }),
    sync: () => request<BillingStatusResponse>("POST", "/sync"),
    cancelSubscription: (id) => request<BillingStatusResponse>("DELETE", `/subscriptions/${id}`),
    resumeSubscription: (id) =>
      request<BillingStatusResponse>("POST", `/subscriptions/${id}/resume`),
    changeSubscription: (id, productId) =>
      request<BillingStatusResponse>("PUT", `/subscriptions/${id}`, { productId }),
  };
}
