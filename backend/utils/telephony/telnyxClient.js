import axios from "axios";

/**
 * Bare Telnyx REST client + account balance read, deliberately kept free of any
 * app-model / billing import. telnyx.js imports billing.js (recordBilledCall),
 * so putting the balance read here lets utils/telnyxMonitor.js (and, through
 * it, utils/billing.js) fetch the balance without creating an import cycle.
 */
export const isTelnyxConfigured = () => Boolean(process.env.TELNYX_API_KEY);

let client = null;
export const getTelnyxClient = () => {
    if (client) return client;
    if (!isTelnyxConfigured()) {
        throw new Error("Telnyx is not configured (TELNYX_API_KEY)");
    }
    client = axios.create({
        baseURL: "https://api.telnyx.com/v2",
        headers: { Authorization: `Bearer ${process.env.TELNYX_API_KEY}` },
    });
    return client;
};

/**
 * Reads the Super Admin's Telnyx account balance - the platform-wide runway,
 * since every admin/agent's call minutes are drawn from this one account.
 * Returns null when Telnyx isn't configured or the call fails; callers MUST
 * treat null as "unknown" and fail safe (never block a paying customer on a
 * monitoring outage).
 *
 * GET /v2/balance -> data: { balance, credit_limit, available_credit, currency }.
 * `available_credit` (balance + credit line) is the true spendable amount.
 */
export const getTelnyxBalance = async () => {
    if (!isTelnyxConfigured()) return null;
    try {
        // Bounded timeout: this runs inline on the payment-activation path, so
        // a slow Telnyx must never hang plan activation (we fail safe to null).
        const { data } = await getTelnyxClient().get("/balance", { timeout: 10000 });
        const d = data?.data || {};
        const balance = Number(d.balance);
        const availableCredit =
            d.available_credit != null ? Number(d.available_credit) : balance;
        return {
            balance: Number.isFinite(balance) ? balance : 0,
            availableCredit: Number.isFinite(availableCredit) ? availableCredit : 0,
            currency: d.currency || "USD",
        };
    } catch (error) {
        console.error("Failed to fetch Telnyx balance:", error?.response?.data || error.message);
        return null;
    }
};
