import Settings from "../models/Settings.js";
import SuperAdmin from "../models/auth/super-admin.js";
import { getTelnyxBalance } from "./telephony/telnyxClient.js";
import { sendTelnyxLowBalanceEmail, sendTelnyxBurnRateEmail } from "./resendEmails.js";

/**
 * Telnyx balance monitoring. All call minutes across every admin/agent are
 * drawn from the Super Admin's single Telnyx account, so this is the
 * platform-wide runway. This module:
 *   - reports a fail-safe balance status (unknown => treat as sufficient so a
 *     monitoring outage never blocks a paying customer),
 *   - emails the super admin when the balance is at/below the threshold,
 *   - emails again when the balance is draining fast (burn-rate),
 *   - all with cooldowns so the super admin is never spammed.
 *
 * Kept free of any dependency on billing.js so billing.js can import from here
 * without a cycle (the reverse direction - activating deferred plans - lives in
 * billing.js).
 */

const threshold = () => Number(process.env.TELNYX_LOW_BALANCE_THRESHOLD || 50);
const cooldownMs = () => Number(process.env.TELNYX_ALERT_COOLDOWN_HOURS || 12) * 3600 * 1000;
const burnAlertHours = () => Number(process.env.TELNYX_BURN_ALERT_HOURS || 48);

const superAdminEmail = async () => {
    // The oldest super admin is the platform owner; fall back to the bootstrap
    // env address (also where the requirement says alerts must land).
    const sa = await SuperAdmin.findOne().sort({ createdAt: 1 }).select("email");
    return sa?.email || process.env.SUPER_ADMIN_EMAIL || null;
};

const cooldownPassed = (last) =>
    !last || Date.now() - new Date(last).getTime() >= cooldownMs();

/**
 * @returns {{ checked, sufficient, available, balance, currency, threshold }}
 * `checked` is false when Telnyx is unconfigured/unreachable; callers must then
 * treat `sufficient: true` as a fail-safe assumption, not a confirmed fact.
 */
export const getBalanceStatus = async () => {
    const t = threshold();
    const bal = await getTelnyxBalance();
    if (!bal) {
        return { checked: false, sufficient: true, available: null, balance: null, currency: "USD", threshold: t };
    }
    return {
        checked: true,
        sufficient: bal.availableCredit > t,
        available: bal.availableCredit,
        balance: bal.balance,
        currency: bal.currency,
        threshold: t,
    };
};

/** Emails the super admin about a low balance, respecting the cooldown. */
export const notifySuperAdminLowBalance = async (status, { force = false } = {}) => {
    if (!status?.checked) return false;
    const settings = await Settings.getSingleton();
    if (!force && !cooldownPassed(settings.telnyxLowBalanceNotifiedAt)) return false;

    const email = await superAdminEmail();
    if (!email) return false;

    try {
        await sendTelnyxLowBalanceEmail(email, {
            balance: status.available,
            currency: status.currency,
            threshold: status.threshold,
        });
        settings.telnyxLowBalanceNotifiedAt = new Date();
        await settings.save();
        return true;
    } catch (error) {
        console.error("Telnyx low-balance email failed:", error.message);
        return false;
    }
};

/**
 * Full monitor sweep (called by the cron): samples the balance, alerts on low
 * balance, and alerts on a fast burn rate vs the previous sample. Returns the
 * status so the caller can also activate any deferred plans when funded.
 */
export const monitorBalance = async () => {
    const status = await getBalanceStatus();
    if (!status.checked) return { status };

    const settings = await Settings.getSingleton();
    const now = Date.now();

    // Burn rate vs the previous sample.
    let burn = null;
    if (settings.telnyxLastBalance != null && settings.telnyxLastBalanceAt) {
        const hours = (now - new Date(settings.telnyxLastBalanceAt).getTime()) / 3_600_000;
        const consumed = settings.telnyxLastBalance - status.available;
        if (hours > 0 && consumed > 0) {
            const ratePerHour = consumed / hours;
            const hoursRemaining = ratePerHour > 0 ? status.available / ratePerHour : Infinity;
            burn = { ratePerHour, hoursRemaining };
        }
    }

    // Record this sample for the next run's burn calculation.
    settings.telnyxLastBalance = status.available;
    settings.telnyxLastBalanceAt = new Date();

    const email = await superAdminEmail();

    // Low-balance alert (with cooldown). Reset the cooldown once recovered so
    // the next dip alerts immediately.
    if (!status.sufficient) {
        if (email && cooldownPassed(settings.telnyxLowBalanceNotifiedAt)) {
            try {
                await sendTelnyxLowBalanceEmail(email, {
                    balance: status.available,
                    currency: status.currency,
                    threshold: status.threshold,
                });
                settings.telnyxLowBalanceNotifiedAt = new Date();
            } catch (error) {
                console.error("Telnyx low-balance email failed:", error.message);
            }
        }
    } else {
        settings.telnyxLowBalanceNotifiedAt = null;
    }

    // Fast-burn alert (fires even above threshold), with its own cooldown.
    if (
        burn &&
        Number.isFinite(burn.hoursRemaining) &&
        burn.hoursRemaining <= burnAlertHours() &&
        email &&
        cooldownPassed(settings.telnyxBurnRateNotifiedAt)
    ) {
        try {
            await sendTelnyxBurnRateEmail(email, {
                balance: status.available,
                currency: status.currency,
                ratePerHour: burn.ratePerHour,
                hoursRemaining: burn.hoursRemaining,
            });
            settings.telnyxBurnRateNotifiedAt = new Date();
        } catch (error) {
            console.error("Telnyx burn-rate email failed:", error.message);
        }
    }

    await settings.save();
    return { status, burn };
};
