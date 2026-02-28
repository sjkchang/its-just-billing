import { describe, it, expect } from "vitest";
import { EntitlementResolver } from "../core/domain";

describe("EntitlementResolver", () => {
  describe("zero-config (no config)", () => {
    const resolver = new EntitlementResolver();

    it("returns ['plan:free'] when no active products", () => {
      const result = resolver.resolve([]);
      expect(result).toEqual(new Set(["plan:free"]));
    });

    it("returns ['plan:paid'] when any product is active", () => {
      const result = resolver.resolve(["some-product-id"]);
      expect(result).toEqual(new Set(["plan:paid"]));
    });

    it("returns ['plan:paid'] for multiple active products", () => {
      const result = resolver.resolve(["prod-1", "prod-2"]);
      expect(result).toEqual(new Set(["plan:paid"]));
    });
  });

  describe("custom config", () => {
    const resolver = new EntitlementResolver({
      products: {
        "prod-starter": ["plan:paid", "feature:basic"],
        "prod-pro": ["plan:paid", "feature:basic", "feature:advanced"],
      },
      defaultPaid: ["plan:paid"],
      defaultFree: ["plan:free"],
    });

    it("returns mapped entitlements for configured product", () => {
      const result = resolver.resolve(["prod-starter"]);
      expect(result).toEqual(new Set(["plan:paid", "feature:basic"]));
    });

    it("returns defaultPaid for unmapped product", () => {
      const result = resolver.resolve(["unknown-product"]);
      expect(result).toEqual(new Set(["plan:paid"]));
    });

    it("returns union of entitlements for multiple active products", () => {
      const result = resolver.resolve(["prod-starter", "prod-pro"]);
      expect(result).toEqual(new Set(["plan:paid", "feature:basic", "feature:advanced"]));
    });

    it("returns defaultFree when no active products", () => {
      const result = resolver.resolve([]);
      expect(result).toEqual(new Set(["plan:free"]));
    });

    it("unions mapped and unmapped product entitlements", () => {
      const result = resolver.resolve(["prod-starter", "unknown-product"]);
      expect(result).toEqual(new Set(["plan:paid", "feature:basic"]));
    });
  });

  describe("static helpers", () => {
    const set = new Set(["plan:paid", "feature:basic", "feature:advanced"]);

    describe("has", () => {
      it("returns true when entitlement exists", () => {
        expect(EntitlementResolver.has(set, "plan:paid")).toBe(true);
      });

      it("returns false when entitlement is missing", () => {
        expect(EntitlementResolver.has(set, "plan:free")).toBe(false);
      });
    });

    describe("hasAll", () => {
      it("returns true when all entitlements exist", () => {
        expect(EntitlementResolver.hasAll(set, ["plan:paid", "feature:basic"])).toBe(true);
      });

      it("returns false when any entitlement is missing", () => {
        expect(EntitlementResolver.hasAll(set, ["plan:paid", "feature:missing"])).toBe(false);
      });

      it("returns true for empty required list", () => {
        expect(EntitlementResolver.hasAll(set, [])).toBe(true);
      });
    });

    describe("hasAny", () => {
      it("returns true when any entitlement exists", () => {
        expect(EntitlementResolver.hasAny(set, ["plan:free", "feature:basic"])).toBe(true);
      });

      it("returns false when no entitlements exist", () => {
        expect(EntitlementResolver.hasAny(set, ["plan:free", "feature:missing"])).toBe(false);
      });

      it("returns false for empty required list", () => {
        expect(EntitlementResolver.hasAny(set, [])).toBe(false);
      });
    });
  });
});
