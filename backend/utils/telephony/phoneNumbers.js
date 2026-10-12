/**
 * E.164 normalisation.
 *
 * Everything downstream of the dial button assumes a single canonical format:
 * the dialplan only matches `_+X.`, Telnyx rejects anything else on the trunk,
 * and CallRecord rows are only comparable if they agree. So the API normalises
 * once, at /calls/start, and the browser dials exactly what it is given back.
 *
 * A local number like 03297248793 is ambiguous without a country, which is what
 * DEFAULT_DIAL_COUNTRY_CODE is for (e.g. +92 for Pakistan): a single leading 0
 * is a national trunk prefix and gets swapped for the country code. With no
 * default configured, a local-looking number is rejected rather than guessed -
 * guessing wrong dials a stranger in another country and bills for it.
 */

const DIGITS_ONLY = /[^\d+]/g;

/**
 * @returns {{ ok: true, e164: string } | { ok: false, reason: string }}
 */
export const toE164 = (input) => {
    const raw = String(input || "").replace(DIGITS_ONLY, "");
    if (!raw) return { ok: false, reason: "INVALID_NUMBER" };

    // Already international.
    if (raw.startsWith("+")) {
        const digits = raw.slice(1);
        if (digits.length < 7 || digits.length > 15) {
            return { ok: false, reason: "INVALID_NUMBER" };
        }
        return { ok: true, e164: `+${digits}` };
    }

    // 00 is the other way to write +, used across most of Europe and Asia.
    if (raw.startsWith("00")) {
        return toE164(`+${raw.slice(2)}`);
    }

    const country = String(process.env.DEFAULT_DIAL_COUNTRY_CODE || "").replace(DIGITS_ONLY, "");

    // National format: one leading 0, then the subscriber number.
    if (raw.startsWith("0")) {
        if (!country) return { ok: false, reason: "NUMBER_NEEDS_COUNTRY_CODE" };
        return toE164(`${country.startsWith("+") ? country : `+${country}`}${raw.slice(1)}`);
    }

    // Bare subscriber number, no prefix at all.
    if (!country) return { ok: false, reason: "NUMBER_NEEDS_COUNTRY_CODE" };
    return toE164(`${country.startsWith("+") ? country : `+${country}`}${raw}`);
};

/**
 * Asterisk posts form-encoded bodies, where a literal `+` decodes to a space.
 * The dialplan wraps values in URIENCODE() to stop that, but a hand-run curl or
 * an older dialplan copy might not - so anything that arrives looking like a
 * bare international number is repaired here rather than silently mis-billed
 * against the wrong destination string.
 */
export const repairE164 = (value) => {
    const raw = String(value || "").trim();
    if (raw.startsWith("+")) return raw;
    if (raw.startsWith(" ")) return `+${raw.trim()}`;
    if (/^\d{7,15}$/.test(raw)) return `+${raw}`;
    return raw;
};
