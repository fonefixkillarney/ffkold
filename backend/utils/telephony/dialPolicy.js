/**
 * Which destinations agents are allowed to dial.
 *
 * Configured with ALLOWED_DIAL_REGIONS in .env, e.g. `UK,IE`. Empty or unset
 * means no restriction, so existing deployments keep working unchanged.
 *
 * Each entry is either one of the region labels the app already uses for
 * PhoneNumber.region (UK, IE, US, CA) or a raw dialling prefix (`+44`), so an
 * unusual destination can be allowed without this file being edited.
 *
 * This is a cost control, not a security boundary against the agent's own
 * browser - though it is enforced as one. It runs in BOTH places a destination
 * is known:
 *
 *   1. POST /api/agent/calls/start   - refuses before a call reference is
 *      minted, so the browser gets a message it can show the agent, and the
 *      INVITE is never sent.
 *   2. POST /api/telephony/asterisk/authorize-dial - refuses again at the PBX,
 *      before the trunk leg exists. This is the one that matters: it is the
 *      last gate before Telnyx is billed, and it holds even if a call
 *      reference is somehow replayed or the API in front of it is bypassed.
 *
 * Note on +1: US and CA share it, so allowing either allows both. UK and
 * Ireland have distinct prefixes and are cleanly separable.
 */

const REGION_PREFIXES = {
    UK: ["+44"],
    GB: ["+44"], // ISO alpha-2 spelling of the same thing
    IE: ["+353"],
    US: ["+1"],
    CA: ["+1"],
    PK: ["+92"],
};

const REGION_LABELS = {
    "+44": "UK",
    "+353": "Ireland",
    "+1": "US/Canada",
    "+92": "Pakistan",
};

/**
 * The configured allow-list as dialling prefixes. An empty array means
 * "no policy configured" - every destination is permitted.
 */
export const getAllowedDialPrefixes = () => {
    const configured = (process.env.ALLOWED_DIAL_REGIONS || "").trim();
    if (!configured) return [];

    const prefixes = new Set();
    for (const rawEntry of configured.split(",")) {
        const entry = rawEntry.trim();
        if (!entry) continue;

        if (entry.startsWith("+")) {
            // Raw prefix, e.g. "+44". Strip anything that isn't a digit so a
            // stray space or dash in .env can't silently disable an entry.
            const cleaned = `+${entry.slice(1).replace(/\D/g, "")}`;
            if (cleaned.length > 1) prefixes.add(cleaned);
            continue;
        }

        for (const prefix of REGION_PREFIXES[entry.toUpperCase()] ?? []) {
            prefixes.add(prefix);
        }
    }

    return [...prefixes];
};

export const isDialPolicyEnforced = () => getAllowedDialPrefixes().length > 0;

/**
 * @param {string} e164 destination in E.164 (`+441234567890`)
 * @returns {{ allowed: boolean, reason: string|null }}
 *          `DESTINATION_NOT_ALLOWED` when the policy refuses it.
 */
export const isDestinationAllowed = (e164) => {
    const prefixes = getAllowedDialPrefixes();
    if (prefixes.length === 0) return { allowed: true, reason: null };

    const number = String(e164 || "").trim();
    if (!number.startsWith("+")) {
        // Everything upstream normalises to E.164 first, so a non-E.164 string
        // reaching here means something is wrong - fail closed rather than let
        // an unrecognised format skip the policy entirely.
        return { allowed: false, reason: "DESTINATION_NOT_ALLOWED" };
    }

    const allowed = prefixes.some((prefix) => number.startsWith(prefix));
    return { allowed, reason: allowed ? null : "DESTINATION_NOT_ALLOWED" };
};

/** Human-readable policy, for startup logs and refusal messages. */
export const describeDialPolicy = () => {
    const prefixes = getAllowedDialPrefixes();
    if (prefixes.length === 0) return "all destinations";
    return prefixes
        .map((prefix) => `${REGION_LABELS[prefix] ?? "custom"} (${prefix})`)
        .join(", ");
};
