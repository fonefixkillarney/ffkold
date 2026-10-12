import crypto from "crypto";
import { clampSeats } from "./planConfig.js";
import {
    convertMinor,
    getBaseCurrency,
    getLocalCurrency,
    isSupportedCurrency,
} from "./currency.js";

/**
 * Payment amounts are ALWAYS derived here from the server-side plan config,
 * never from the client. A create-payment request carries only a plan key, a
 * seat count, and a currency choice - the price behind them is looked up from
 * .env every single time, so tampering with the request body can change what
 * you buy but never what it costs.
 *
 * Amounts are returned in the currency's MINOR unit (cents/pence/paisa).
 */

// Gateways that can only settle Pakistani rupees. A provider missing from this
// list silently keeps the customer's chosen display currency, so a $11 plan is
// handed to the gateway as "11" and charged as PKR 11 - no validation anywhere
// catches it, because 11 is a perfectly valid amount.
const LOCAL_PROVIDERS = ["easypaisa", "nayapay", "jazzcash"];

export const isLocalProvider = (provider) => LOCAL_PROVIDERS.includes(provider);

/**
 * The currency a given provider will actually settle in.
 *
 * The Pakistani wallets only move rupees, so they ignore the customer's
 * display-currency choice. Paddle can settle any supported currency.
 */
export const resolveCurrencyForProvider = (provider, requestedCurrency) => {
    if (isLocalProvider(provider)) return getLocalCurrency();
    const requested = String(requestedCurrency || "").trim().toUpperCase();
    return isSupportedCurrency(requested) ? requested : getBaseCurrency();
};

/**
 * What to charge for `seats` seats of `plan`, in `currency`.
 *
 * @returns {{ seats, amountMinor, amountMajor, currency, unitAmountMinor }}
 */
export const resolveCharge = ({ plan, seats, currency }) => {
    const billedSeats = clampSeats(plan, seats);
    const code = isSupportedCurrency(currency) ? currency.trim().toUpperCase() : getBaseCurrency();

    const unitAmountMinor = convertMinor(plan.pricePerUser, code);
    const amountMinor = unitAmountMinor * billedSeats;

    return {
        seats: billedSeats,
        unitAmountMinor,
        amountMinor,
        amountMajor: Number((amountMinor / 100).toFixed(2)),
        currency: code,
    };
};

/** Same, but with the currency forced to whatever the provider can settle. */
export const resolveChargeForProvider = ({ provider, plan, seats, currency }) =>
    resolveCharge({
        plan,
        seats,
        currency: resolveCurrencyForProvider(provider, currency),
    });

/**
 * Unique, URL-safe, human-scannable merchant order reference. Prefixed with the
 * provider so gateway dashboards and our logs are self-describing. Uppercase +
 * digits keeps it compatible with gateways that reject long/special-char refs.
 */
export const generateOrderId = (provider) => {
    const rand = crypto.randomBytes(9).toString("hex").toUpperCase();
    const stamp = Date.now().toString(36).toUpperCase();
    return `${provider.slice(0, 3).toUpperCase()}-${stamp}-${rand}`;
};
