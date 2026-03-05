/**
 * Billing cart service — persistent shopping cart for one-time purchases.
 */

import type { Cart, CartItem } from "../core/entities";
import type { BillingUser } from "../core/hooks";
import { BillingBadRequestError, BillingNotFoundError } from "../core/errors";
import type { BillingContext } from "../core/types";
import { createId } from "../core/types";
import { isManagedProduct } from "../core/config";

export class BillingCartService {
  constructor(private ctx: BillingContext) {}

  private isAllowMultiple(productId: string): boolean {
    const products = this.ctx.config.products;
    if (!products) return false;
    const entry = products.find(
      (e) => isManagedProduct(e) && e.id === productId
    );
    return entry && isManagedProduct(entry) ? entry.allowMultiple : false;
  }

  async getCart(user: BillingUser): Promise<Cart> {
    const items = await this.ctx.adapter.cartItems.findByUserId(user.id);
    return { userId: user.id, items };
  }

  async addItem(
    user: BillingUser,
    input: { productId: string; quantity?: number }
  ): Promise<CartItem> {
    const product = await this.ctx.providers.products.getProduct(input.productId);
    if (!product) {
      throw new BillingBadRequestError(`Invalid product ID: ${input.productId}`);
    }

    const quantity = input.quantity ?? 1;
    if (quantity > 1 && !this.isAllowMultiple(input.productId)) {
      throw new BillingBadRequestError(
        `Product "${input.productId}" does not allow multiple quantities`
      );
    }

    return this.ctx.adapter.cartItems.upsert({
      id: createId(),
      userId: user.id,
      productId: input.productId,
      quantity,
    });
  }

  async updateItem(
    user: BillingUser,
    productId: string,
    input: { quantity: number }
  ): Promise<CartItem> {
    const existing = await this.ctx.adapter.cartItems.findByUserId(user.id);
    const item = existing.find((i) => i.productId === productId);
    if (!item) {
      throw new BillingNotFoundError("Cart item not found");
    }

    if (input.quantity > 1 && !this.isAllowMultiple(productId)) {
      throw new BillingBadRequestError(
        `Product "${productId}" does not allow multiple quantities`
      );
    }

    return this.ctx.adapter.cartItems.upsert({
      id: item.id,
      userId: user.id,
      productId,
      quantity: input.quantity,
    });
  }

  async removeItem(user: BillingUser, productId: string): Promise<void> {
    await this.ctx.adapter.cartItems.remove(user.id, productId);
  }

  async clearCart(user: BillingUser): Promise<void> {
    await this.ctx.adapter.cartItems.clear(user.id);
  }

  async checkoutCart(
    user: BillingUser,
    input: { successUrl: string; cancelUrl?: string }
  ): Promise<{ checkoutUrl: string }> {
    if (!this.ctx.providers.checkout.createPurchaseCheckoutSession) {
      throw new BillingBadRequestError("One-time purchases are not supported by this provider");
    }

    const items = await this.ctx.adapter.cartItems.findByUserId(user.id);
    if (items.length === 0) {
      throw new BillingBadRequestError("Cart is empty");
    }

    // Validate all products exist
    for (const item of items) {
      const product = await this.ctx.providers.products.getProduct(item.productId);
      if (!product) {
        throw new BillingBadRequestError(`Product no longer available: ${item.productId}`);
      }
    }

    // Get or create customer
    const provider = this.ctx.providerType;
    let customer = await this.ctx.adapter.customers.findByUserId(user.id, provider);
    if (!customer) {
      const providerCustomer = await this.ctx.providers.customers.createCustomer(
        user.email,
        user.id,
        user.name ?? undefined
      );
      customer = await this.ctx.adapter.customers.create({
        id: createId(),
        userId: user.id,
        provider,
        providerCustomerId: providerCustomer.id,
        email: user.email,
        name: user.name,
      });
    }

    // Create checkout session (outside transaction to avoid holding DB connections)
    const session = await this.ctx.providers.checkout.createPurchaseCheckoutSession({
      customerId: customer.providerCustomerId,
      items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
    });

    // Clear cart only after successful provider response
    await this.ctx.adapter.cartItems.clear(user.id);

    this.ctx.logger.info("Cart checkout session created", {
      userId: user.id,
      itemCount: items.length,
    });

    return { checkoutUrl: session.checkoutUrl };
  }
}
