import crypto from "crypto";

/**
 * Shared numeric verification-code generator used by every email-verification
 * flow (super admin/admin registration, and now every admin, super admin, and
 * agent login). Callers still choose the length, but in practice everything is
 * on 6 digits - the generation/hashing logic itself lives in exactly one place.
 */
export const generateNumericCode = (digits = 6) => {
    const max = 10 ** digits;
    return String(crypto.randomInt(0, max)).padStart(digits, "0");
};

// Codes are never stored raw - only this hash is persisted, mirroring how
// passwordHash/passwordResetTokenHash are handled elsewhere in the app.
export const hashCode = (code) => crypto.createHash("sha256").update(String(code)).digest("hex");
