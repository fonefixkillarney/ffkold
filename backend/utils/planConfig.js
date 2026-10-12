import { PLAN_KEYS, PLAN_DEFAULT_NAMES } from "./planCatalog.js";
import { buildPriceTable, getBaseCurrency, getSupportedCurrencies } from "./currency.js";

/**
 * Single source of truth for both plans.
 *
 * Every value is read from process.env at request time, so a super admin
 * changes pricing by editing be-enterdial/.env and restarting the server - no
 * DB write, no code deploy. Nothing is ever read back from Mongo, and the
 * client can never influence a price: a checkout request only carries a plan
 * key, a seat count, and a currency.
 *
 * Money in .env is written in MAJOR units, the way a human quotes it
 * (PLAN_LIGHT_PRICE_PER_USER=11 means $11.00). Everything this module returns
 * is in MINOR units (cents), which is the convention the rest of the codebase
 * and the frontend already use.
 */
const toNumber = (value, fallback) => {
    if (value === undefined || value === "") return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const toMinor = (value, fallback = 0) => Math.round(toNumber(value, fallback) * 100);

const toBool = (value, fallback) => {
    if (value === undefined || value === "") return fallback;
    return String(value).trim().toLowerCase() === "true";
};

// A plan flagged unlimited still needs a hard ceiling so a typo in a seat
// field can't mint a million seats in one order.
const UNLIMITED_SEAT_CAP = 5000;

const buildPlanFromEnv = (key) => {
    const prefix = `PLAN_${key.toUpperCase()}_`;

    const pricePerUser = toMinor(process.env[`${prefix}PRICE_PER_USER`], 0);
    const unlimitedAgents = toBool(process.env[`${prefix}UNLIMITED_AGENTS`], false);
    const minAgents = Math.max(1, toNumber(process.env[`${prefix}MIN_AGENTS`], 1));
    const configuredMax = Math.max(minAgents, toNumber(process.env[`${prefix}MAX_AGENTS`], 1));

    return {
        key,
        name: process.env[`${prefix}NAME`] || PLAN_DEFAULT_NAMES[key],
        minutesPerUser: toNumber(process.env[`${prefix}MINUTES_PER_USER`], 0),

        // Authored price, per seat per month, in base-currency minor units.
        pricePerUser,
        currency: getBaseCurrency(),
        // Same price expressed in every currency we sell in, so the frontend
        // never has to do FX itself and can't drift from what we charge.
        prices: buildPriceTable(pricePerUser),
        supportedCurrencies: getSupportedCurrencies(),

        // Seat range purchasable on this plan. `unlimitedAgents` is what the
        // marketing card reads ("Unlimited Agents"); maxAgents is the hard cap
        // the server actually enforces.
        minAgents,
        maxAgents: unlimitedAgents ? UNLIMITED_SEAT_CAP : configuredMax,
        unlimitedAgents,

        paddlePriceId: process.env[`${prefix}PADDLE_PRICE_ID`] || null,
        isActive: toBool(process.env[`${prefix}ACTIVE`], false),
    };
};

export const getAllPlans = () => PLAN_KEYS.map(buildPlanFromEnv);

export const getPlanByKey = (key) => getAllPlans().find((plan) => plan.key === key) || null;

export const getActivePlans = () => getAllPlans().filter((plan) => plan.isActive);

export const getActivePlanByKey = (key) => {
    const plan = getPlanByKey(key);
    return plan && plan.isActive ? plan : null;
};

/**
 * Clamps a requested seat count into the plan's allowed range. Always applied
 * server-side before a price is computed - a client asking for 0 or 10,000
 * seats gets a valid order, not a free or unbounded one.
 */
export const clampSeats = (plan, requestedSeats) => {
    const seats = Math.floor(toNumber(requestedSeats, plan.minAgents));
    if (!Number.isFinite(seats)) return plan.minAgents;
    return Math.min(plan.maxAgents, Math.max(plan.minAgents, seats));
};
