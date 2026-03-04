/**
 * Billing error classes.
 *
 * Used by services and the web handler within the billing package.
 * The handler maps these to HTTP status codes.
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

export class BillingUnauthorizedError extends BillingError {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "BillingUnauthorizedError";
  }
}

export class BillingNotFoundError extends BillingError {
  constructor(message = "Not found") {
    super(message);
    this.name = "BillingNotFoundError";
  }
}
