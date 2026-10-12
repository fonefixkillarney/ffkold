/**
 * Multi-currency pricing.
 *
 * USD is the ONE authored price (PLAN_<KEY>_PRICE_PER_USER in .env). Every
 * other currency is derived from it with a fixed rate, also from .env, so a
 * super admin only ever edits one price per plan and the whole currency table
 * moves with it.
 *
 * Money convention (unchanged across the codebase): amounts are integers in the
 * currency's MINOR unit - cents, pence, paisa. Divide by 100 to display.
 */

const DEFAULT_RATES = {
    USD: 1,
    GBP: 0.79,
    EUR: 0.92,
    PKR: 278,
};

// How far a converted price is rounded, in minor units. Nobody quotes a price
// in paisa, so PKR lands on a whole rupee; the rest land on a whole major unit
// too, which is what a pricing table should look like.
const ROUNDING_STEP_MINOR = {
    USD: 100,
    GBP: 100,
    EUR: 100,
    PKR: 10000, // nearest 100 rupees - PKR prices are large numbers
};

const toNumber = (value, fallback) => {
    if (value === undefined || value === "") return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/** The currency every plan price in .env is authored in. */
export const getBaseCurrency = () =>
    (process.env.DEFAULT_CURRENCY || "USD").trim().toUpperCase();

/** The currency the Pakistani gateways (Easypaisa/NayaPay) always charge in. */
export const getLocalCurrency = () =>
    (process.env.LOCAL_CURRENCY || "PKR").trim().toUpperCase();

/** Currencies a customer may choose from. Always includes the base currency. */
export const getSupportedCurrencies = () => {
    const configured = (process.env.SUPPORTED_CURRENCIES || "USD,GBP,EUR,PKR")
        .split(",")
        .map((code) => code.trim().toUpperCase())
        .filter(Boolean);

    const base = getBaseCurrency();
    return [base, ...configured.filter((code) => code !== base)];
};

export const isSupportedCurrency = (code) =>
    typeof code === "string" && getSupportedCurrencies().includes(code.trim().toUpperCase());

/** Units of `currency` per 1 unit of the base currency. */
export const getRate = (currency) => {
    const code = currency.trim().toUpperCase();
    if (code === getBaseCurrency()) return 1;
    return toNumber(process.env[`FX_RATE_${code}`], DEFAULT_RATES[code] ?? 1);
};

/**
 * Converts a base-currency minor amount into `currency`, rounded up to that
 * currency's quoting step. Rounding UP, never down, so a favourable rounding
 * can never sell a plan below its authored USD price.
 */
export const convertMinor = (baseMinor, currency) => {
    const code = currency.trim().toUpperCase();
    if (code === getBaseCurrency()) return Math.round(baseMinor);

    const raw = baseMinor * getRate(code);
    const step = ROUNDING_STEP_MINOR[code] ?? 100;
    return Math.ceil(raw / step) * step;
};

/** `{ USD: 1100, GBP: 900, ... }` for one base-currency amount. */
export const buildPriceTable = (baseMinor) =>
    Object.fromEntries(
        getSupportedCurrencies().map((code) => [code, convertMinor(baseMinor, code)])
    );

export const formatMinor = (minor, currency, locale = "en-US") => {
    try {
        return new Intl.NumberFormat(locale, { style: "currency", currency }).format(minor / 100);
    } catch {
        return `${(minor / 100).toFixed(2)} ${currency}`;
    }
};
