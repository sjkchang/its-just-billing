/**
 * Shared webhook provider contract tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { ProviderFactory, ProviderTestContext } from "./harness";

export function defineWebhookTests(factory: ProviderFactory) {
  describe("WebhookProvider", () => {
    let ctx: ProviderTestContext;

    beforeEach(async () => {
      ctx = await factory();
    });

    afterEach(async () => {
      await ctx.cleanup();
    });

    it("isRelevantEvent returns true for subscription events", () => {
      expect(ctx.providers.webhooks.isRelevantEvent(ctx.sampleRelevantEvent)).toBe(true);
    });

    it("isRelevantEvent returns false for random events", () => {
      expect(ctx.providers.webhooks.isRelevantEvent("random.unknown.event")).toBe(false);
    });

    it("extractResource returns null for invalid input", () => {
      const result = ctx.providers.webhooks.extractResource(null);
      expect(result).toBeNull();
    });

    it("verifySignature returns null for invalid payload", () => {
      const result = ctx.providers.webhooks.verifySignature("not-json", {});
      expect(result).toBeNull();
    });
  });
}
