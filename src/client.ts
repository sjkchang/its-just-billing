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
  accessState: "active" | "trialing" | "grace_period" | "suspended" | "canceled" | "provider_missing" | "free";
  productId: string | null;
  productName: string | null;
  productDescription: string | null;
  subscription: {
    id: string;
    status: string;
    currentPeriodEnd: string | null;
    pendingCancellation: boolean;
    pendingProductId: string | null;
  } | null;
  purchases: {
    id: string;
    providerProductId: string;
    quantity: number;
    amount: number;
    currency: string;
    purchasedAt: string;
  }[];
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
    interval: "day" | "week" | "month" | "year" | "one_time";
  }[];
  metadata?: Record<string, string>;
  allowMultiple: boolean;
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

export interface CartItemResponse {
  productId: string;
  quantity: number;
  createdAt: string;
  updatedAt: string;
}

export interface CartResponse {
  userId: string;
  items: CartItemResponse[];
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
  purchase(input: {
    items: { productId: string; quantity?: number }[];
    successUrl: string;
    cancelUrl?: string;
  }): Promise<CheckoutResponse>;
  createPortal(returnUrl: string): Promise<PortalResponse>;
  sync(): Promise<BillingStatusResponse>;
  cancelSubscription(id: string): Promise<BillingStatusResponse>;
  resumeSubscription(id: string): Promise<BillingStatusResponse>;
  changeSubscription(id: string, productId: string, interval?: "day" | "week" | "month" | "year"): Promise<BillingStatusResponse>;
  cancelScheduledChange(id: string): Promise<BillingStatusResponse>;
  getCart(): Promise<CartResponse>;
  addCartItem(input: { productId: string; quantity?: number }): Promise<CartItemResponse>;
  updateCartItem(productId: string, input: { quantity: number }): Promise<CartItemResponse>;
  removeCartItem(productId: string): Promise<{ success: boolean }>;
  clearCart(): Promise<{ success: boolean }>;
  checkoutCart(input: { successUrl: string; cancelUrl?: string }): Promise<CheckoutResponse>;
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
      const serverMessage =
        errorBody && typeof errorBody === "object" && "error" in errorBody && typeof (errorBody as Record<string, unknown>).error === "string"
          ? (errorBody as Record<string, string>).error
          : `Billing API error: ${res.status}`;
      throw new BillingClientError(serverMessage, res.status, errorBody);
    }

    return res.json() as Promise<T>;
  }

  return {
    getStatus: () => request<BillingStatusResponse>("GET", "/status"),
    getProducts: () => request<ProductsListResponse>("GET", "/products"),
    checkout: (input) => request<CheckoutResponse>("POST", "/checkout", input),
    purchase: (input) => request<CheckoutResponse>("POST", "/purchase", input),
    createPortal: (returnUrl) => request<PortalResponse>("POST", "/portal", { returnUrl }),
    sync: () => request<BillingStatusResponse>("POST", "/sync"),
    cancelSubscription: (id) => request<BillingStatusResponse>("DELETE", `/subscriptions/${encodeURIComponent(id)}`),
    resumeSubscription: (id) =>
      request<BillingStatusResponse>("POST", `/subscriptions/${encodeURIComponent(id)}/resume`),
    changeSubscription: (id, productId, interval?) =>
      request<BillingStatusResponse>("PUT", `/subscriptions/${encodeURIComponent(id)}`, { productId, ...(interval && { interval }) }),
    cancelScheduledChange: (id) =>
      request<BillingStatusResponse>("DELETE", `/subscriptions/${encodeURIComponent(id)}/scheduled-change`),
    getCart: () => request<CartResponse>("GET", "/cart"),
    addCartItem: (input) => request<CartItemResponse>("POST", "/cart/items", input),
    updateCartItem: (productId, input) =>
      request<CartItemResponse>("PATCH", `/cart/items/${encodeURIComponent(productId)}`, input),
    removeCartItem: (productId) =>
      request<{ success: boolean }>("DELETE", `/cart/items/${encodeURIComponent(productId)}`),
    clearCart: () => request<{ success: boolean }>("DELETE", "/cart"),
    checkoutCart: (input) => request<CheckoutResponse>("POST", "/cart/checkout", input),
  };
}
