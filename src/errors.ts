/**
 * Billing error classes.
 *
 * Used by services and routes within the billing package.
 * The Hono error handler in routes.ts maps these to HTTP status codes.
 */

export class BillingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingError";
  }
}

export class BillingBadRequestError extends BillingError {
  constructor(message = "Bad request") {
    super(message);
    this.name = "BillingBadRequestError";
  }
}

export class BillingNotFoundError extends BillingError {
  constructor(message = "Not found") {
    super(message);
    this.name = "BillingNotFoundError";
  }
}
