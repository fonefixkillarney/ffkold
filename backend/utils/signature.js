import crypto from "crypto";

/** HMAC-SHA256 of a string/Buffer, hex-encoded. */
export const hmacSha256Hex = (payload, secret) =>
    crypto.createHmac("sha256", secret).update(payload).digest("hex");

/** HMAC-SHA256, base64-encoded (some gateways send base64 signatures). */
export const hmacSha256Base64 = (payload, secret) =>
    crypto.createHmac("sha256", secret).update(payload).digest("base64");

/**
 * Constant-time comparison of two signatures. Falls back to `false` on any
 * length mismatch instead of throwing, so a malformed header can never crash
 * the webhook handler. Never use === for signature comparison - it leaks
 * timing information an attacker can use to forge a valid signature.
 */
export const safeEqual = (a, b) => {
    if (typeof a !== "string" || typeof b !== "string") return false;
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
};
