/**
 * Per-call authorisation tokens.
 *
 * The problem this solves: a browser must hold its own SIP password to
 * register with Asterisk, and anything the browser holds can be read out of
 * devtools. Without another control, a copied SIP password would let someone
 * place billable PSTN calls through the trunk forever, with no session and no
 * plan behind them.
 *
 * So dialling takes two things: SIP credentials AND a call reference minted by
 * POST /api/agent/calls/start, which requires a live JWT session and passes the
 * usual checkCanDial gates. The browser puts the reference in an X-Call-Ref SIP
 * header; the dialplan hands it back to /authorize-dial before the trunk leg is
 * created; a call without a valid one is refused. Stolen SIP credentials alone
 * dial nothing.
 *
 * The token is a keyed MAC, not a stored record: `<agentId>.<expiry>.<mac>`,
 * where the MAC covers the destination too, so a reference minted for one
 * number cannot be replayed against another. Nothing is written to Mongo and
 * nothing is held in process memory, so this works unchanged behind several API
 * instances.
 *
 * Within its 60-second window a reference can be presented more than once (the
 * same agent could place the same call twice). That is deliberate - closing it
 * would need shared state, and every call still re-runs checkCanDial and is
 * separately logged and billed, so the worst case is a duplicate call the agent
 * asked for.
 *
 * Format is dot-separated hex only: no `+`, `/` or `=` to be mangled by a
 * urlencoded form body or a SIP header.
 */

import { hmacSha256Hex, safeEqual } from "../signature.js";

const TTL_SECONDS = 60;

const secret = () => {
    const value = process.env.ASTERISK_SHARED_SECRET;
    if (!value) {
        throw new Error("ASTERISK_SHARED_SECRET is not set - calls cannot be authorised");
    }
    return value;
};

const sign = (agentId, toE164, expiresAt) =>
    hmacSha256Hex(`${agentId}|${toE164}|${expiresAt}`, secret());

/** @returns {string} the reference to travel in the X-Call-Ref SIP header. */
export const mintCallRef = (agentId, toE164) => {
    const expiresAt = Math.floor(Date.now() / 1000) + TTL_SECONDS;
    return `${agentId}.${expiresAt}.${sign(agentId, toE164, expiresAt)}`;
};

/**
 * @returns {{ valid: boolean, agentId: string|null, reason: string|null }}
 *          `reason` is a short machine code for the Asterisk log, never shown
 *          to an agent - the browser already learned why from /calls/start.
 */
export const verifyCallRef = (ref, toE164) => {
    const parts = String(ref || "").split(".");
    if (parts.length !== 3) {
        return { valid: false, agentId: null, reason: "REF_MALFORMED" };
    }

    const [agentId, expiresAtRaw, mac] = parts;
    const expiresAt = Number.parseInt(expiresAtRaw, 10);

    if (!Number.isFinite(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) {
        return { valid: false, agentId: null, reason: "REF_EXPIRED" };
    }
    // Recomputed with the destination Asterisk actually dialed, so a reference
    // minted for +441... cannot be reused to dial a premium-rate number.
    if (!safeEqual(mac, sign(agentId, toE164, expiresAt))) {
        return { valid: false, agentId: null, reason: "REF_BAD_SIGNATURE" };
    }

    return { valid: true, agentId, reason: null };
};
