import Stripe from "stripe";

export interface StripeConfig {
  readonly secretKey: string;
  /**
   * Where the Stripe API is: unset for Stripe itself, or stripe-mock's URL in
   * local development and tests (`http://stripe-mock:12111`).
   */
  readonly apiBase?: string | undefined;
}

/**
 * A Stripe client for Workers. The SDK's `workerd` build uses fetch and
 * WebCrypto, so no Node APIs are needed. The API version is the one this SDK
 * release pins (2026-09-30.endive for stripe 23); upgrading the SDK is how it
 * moves, deliberately, like a compatibility date.
 */
export function createStripe(config: StripeConfig): Stripe {
  const base = config.apiBase ? new URL(config.apiBase) : undefined;
  return new Stripe(config.secretKey, {
    // Looked up per call rather than captured when the client is made, so
    // fetch interceptors installed later (MSW in tests) apply.
    httpClient: Stripe.createFetchHttpClient((input, init) =>
      fetch(input, init),
    ),
    // Stripe retries idempotent requests itself; one retry keeps a request's
    // subrequest count and latency bounded.
    maxNetworkRetries: 1,
    ...(base
      ? {
          host: base.hostname,
          port: base.port || (base.protocol === "https:" ? 443 : 80),
          protocol: base.protocol === "https:" ? "https" : "http",
        }
      : {}),
  });
}

/** Webhook signatures are checked with WebCrypto (no Node crypto in Workers). */
export const cryptoProvider = Stripe.createSubtleCryptoProvider();

export type { Stripe };
