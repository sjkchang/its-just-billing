/**
 * BillingInstance — the central orchestrator for the billing package.
 *
 * Wires together providers, adapter, services, and handler.
 * Created by the createBilling() factory.
 */

import type { BillingProviderConfig } from "./providers";
import type { BillingAppConfigInput } from "./core/config";
import { BillingConfigSchema, getManagedProducts } from "./core/config";
import type { BillingRepositories } from "./repositories/types";
import type { BillingUser } from "./core/hooks";
import type { BillingLogger, BillingContext, KeyValueCache } from "./core/types";
import { defaultLogger } from "./core/types";
import { createBillingProviders } from "./providers";

import { BillingSyncService } from "./services/sync";
import { BillingStatusService } from "./services/status";
import { BillingCheckoutService } from "./services/checkout";
import { BillingWebhookService } from "./services/webhook";
import { BillingCartService } from "./services/cart";
import type { BillingStatusResult } from "./services/status";
import type { Cart, CartItem } from "./core/entities";

import { createBillingHandler } from "./handler";

// ============================================================================
// Config types
// ============================================================================

export interface CreateBillingConfig {
  adapter: BillingRepositories;
  provider: BillingProviderConfig;
  resolveUser: (req: Request) => Promise<BillingUser | null>;
  basePath?: string;
  /** Separate mount point for webhook routes (e.g. "/api/v1/webhooks"). */
  webhookPath?: string;
  config?: BillingAppConfigInput;
  logger?: BillingLogger;
  cache?: KeyValueCache;
}

// ============================================================================
// Server-side API
// ============================================================================

export interface BillingAPI {
  getStatus(user: BillingUser): Promise<BillingStatusResult>;
  getEntitlements(user: BillingUser): Promise<string[]>;
  listProducts(): ReturnType<BillingStatusService["listProducts"]>;
  createCheckout(
    user: BillingUser,
    input: { productId: string; successUrl: string; cancelUrl?: string }
  ): ReturnType<BillingCheckoutService["createCheckout"]>;
  createPurchaseCheckout(
    user: BillingUser,
    input: { items: { productId: string; quantity?: number }[]; successUrl: string; cancelUrl?: string }
  ): ReturnType<BillingCheckoutService["createPurchaseCheckout"]>;
  createPortal(
    user: BillingUser,
    returnUrl: string
  ): ReturnType<BillingCheckoutService["createPortal"]>;
  cancelSubscription(user: BillingUser, subscriptionId: string): Promise<void>;
  cancelScheduledChange(user: BillingUser, subscriptionId: string): Promise<void>;
  resumeSubscription(user: BillingUser, subscriptionId: string): Promise<void>;
  changeSubscription(
    user: BillingUser,
    input: { subscriptionId: string; productId: string; interval?: "day" | "week" | "month" | "year" }
  ): Promise<void>;
  syncBillingState(user: BillingUser): Promise<void>;
  handleWebhook(payload: string, headers: Record<string, string>): Promise<void>;
  getCart(user: BillingUser): Promise<Cart>;
  addCartItem(user: BillingUser, input: { productId: string; quantity?: number }): Promise<CartItem>;
  updateCartItem(user: BillingUser, productId: string, input: { quantity: number }): Promise<CartItem>;
  removeCartItem(user: BillingUser, productId: string): Promise<void>;
  clearCart(user: BillingUser): Promise<void>;
  checkoutCart(user: BillingUser, input: { successUrl: string; cancelUrl?: string }): Promise<{ checkoutUrl: string }>;
}

// ============================================================================
// BillingInstance
// ============================================================================

export class BillingInstance {
  readonly handler: (request: Request) => Promise<Response>;
  readonly api: BillingAPI;
  readonly resolveUser: (req: Request) => Promise<BillingUser | null>;
  readonly allowedRedirectOrigins?: string[];

  /** @internal — exposed for handler.ts */
  readonly syncService: BillingSyncService;
  /** @internal */
  readonly statusService: BillingStatusService;
  /** @internal */
  readonly checkoutService: BillingCheckoutService;
  /** @internal */
  readonly webhookService: BillingWebhookService;
  /** @internal */
  readonly cartService: BillingCartService;

  private constructor(
    ctx: BillingContext,
    resolveUser: (req: Request) => Promise<BillingUser | null>,
    basePath: string,
    webhookPath: string | undefined,
  ) {
    this.resolveUser = resolveUser;
    this.allowedRedirectOrigins = ctx.config.allowedRedirectOrigins;

    // Create services
    this.syncService = new BillingSyncService(ctx);
    this.statusService = new BillingStatusService(ctx);
    this.checkoutService = new BillingCheckoutService(ctx);
    this.webhookService = new BillingWebhookService(ctx, this.syncService);
    this.cartService = new BillingCartService(ctx);

    // Create handler
    this.handler = createBillingHandler(this, basePath, webhookPath, ctx.config.allowedRedirectOrigins);

    // Create server-side API
    this.api = {
      getStatus: (user) => this.statusService.getBillingStatus(user),
      getEntitlements: async (user) => {
        const status = await this.statusService.getBillingStatus(user);
        return status.entitlements;
      },
      listProducts: () => this.statusService.listProducts(),
      createCheckout: (user, input) => this.checkoutService.createCheckout(user, input),
      createPurchaseCheckout: (user, input) => this.checkoutService.createPurchaseCheckout(user, input),
      createPortal: (user, returnUrl) => this.checkoutService.createPortal(user, returnUrl),
      cancelSubscription: (user, subscriptionId) =>
        this.checkoutService.cancelSubscription(user, subscriptionId),
      cancelScheduledChange: (user, subscriptionId) =>
        this.checkoutService.cancelScheduledChange(user, subscriptionId),
      resumeSubscription: (user, subscriptionId) =>
        this.checkoutService.uncancelSubscription(user, subscriptionId),
      changeSubscription: (user, input) => this.checkoutService.changeSubscription(user, input),
      syncBillingState: (user) => this.syncService.syncBillingState(user),
      handleWebhook: (payload, headers) => this.webhookService.handleWebhook(payload, headers),
      getCart: (user) => this.cartService.getCart(user),
      addCartItem: (user, input) => this.cartService.addItem(user, input),
      updateCartItem: (user, productId, input) => this.cartService.updateItem(user, productId, input),
      removeCartItem: (user, productId) => this.cartService.removeItem(user, productId),
      clearCart: (user) => this.cartService.clearCart(user),
      checkoutCart: (user, input) => this.cartService.checkoutCart(user, input),
    };
  }

  static async create(createConfig: CreateBillingConfig): Promise<BillingInstance> {
    const logger = createConfig.logger ?? defaultLogger;
    const config = BillingConfigSchema.parse(createConfig.config);
    const basePath = createConfig.basePath ?? "/api/v1/billing";

    const billing = await createBillingProviders(createConfig.provider, config, logger);

    // Non-blocking product sync (only for providers that support it)
    const managedProducts = config.products ? getManagedProducts(config.products) : [];
    if (managedProducts.length > 0 && billing.products.syncProducts) {
      await billing.products.syncProducts(managedProducts)
        .catch((err) => {
          logger.warn("Product sync failed — continuing with existing provider state", {
            error: err instanceof Error ? err.message : String(err),
          });
        });
    }

    const ctx: BillingContext = {
      adapter: createConfig.adapter,
      providers: billing,
      providerType: createConfig.provider.provider,
      config,
      logger,
      cache: createConfig.cache,
    };

    return new BillingInstance(ctx, createConfig.resolveUser, basePath, createConfig.webhookPath);
  }
}
