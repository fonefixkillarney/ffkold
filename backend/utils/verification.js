import bcrypt from "bcryptjs"
import crypto from "node:crypto"

// 4-digit email verification codes, used for both signup and login (see
// controllers/userController.js). The plaintext code lives only in the email we
// send; the DB keeps a bcrypt hash, an expiry, and an attempt counter.

export const CODE_LENGTH = 4
export const CODE_TTL_MINUTES = 10
// 4 digits is 10,000 combinations, so the attempt cap — not the code length —
// is what keeps a pending verification from being brute-forced.
export const MAX_ATTEMPTS = 5
export const RESEND_COOLDOWN_SECONDS = 30

// crypto.randomInt (not Math.random) and zero-padded, so "0042" is as likely as
// any other code.
export function generateCode() {
    return String(crypto.randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0")
}

export function hashCode(code) {
    return bcrypt.hash(code, 10)
}

export function compareCode(code, hash) {
    return bcrypt.compare(code, hash)
}

export function codeExpiry() {
    return new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000)
}

// Mongo update payload that attaches a fresh code to a user and resets the
// guessing budget.
export async function buildCodeFields(code) {
    return {
        verificationCodeHash: await hashCode(code),
        verificationExpires: codeExpiry(),
        verificationAttempts: 0,
        verificationSentAt: new Date(),
    }
}

// Cleared once a code is accepted, so a used code can never be replayed.
export const CLEARED_CODE_FIELDS = {
    verificationCodeHash: null,
    verificationExpires: null,
    verificationAttempts: 0,
    verificationSentAt: null,
}

// The same mechanics again, against the reset* fields on the User model.
//
// These are separate fields on purpose — see the note in models/User.js. A
// verification code is only minted after a correct password and is what /verify
// swaps for a token; a reset code is minted from an email address alone. Sharing
// one field would let a reset code be posted to /verify and return a token with
// no password involved.
export async function buildResetFields(code) {
    return {
        resetCodeHash: await hashCode(code),
        resetExpires: codeExpiry(),
        resetAttempts: 0,
        resetSentAt: new Date(),
    }
}

export const CLEARED_RESET_FIELDS = {
    resetCodeHash: null,
    resetExpires: null,
    resetAttempts: 0,
    resetSentAt: null,
}

// And once more for an email change, against the emailChange* fields. The code
// goes to `pendingEmail`, the address the account is moving to.
export async function buildEmailChangeFields(code, pendingEmail) {
    return {
        pendingEmail,
        emailChangeCodeHash: await hashCode(code),
        emailChangeExpires: codeExpiry(),
        emailChangeAttempts: 0,
        emailChangeSentAt: new Date(),
    }
}

export const CLEARED_EMAIL_CHANGE_FIELDS = {
    pendingEmail: null,
    emailChangeCodeHash: null,
    emailChangeExpires: null,
    emailChangeAttempts: 0,
    emailChangeSentAt: null,
}

// Shortest password we will accept anywhere. The register form already asks for
// 6 (minLength on the input), but the API never enforced it, so a one-character
// password was accepted by POST /user/register. Both endpoints check it now.
export const MIN_PASSWORD_LENGTH = 6

// Seconds a caller still has to wait before another code may be sent.
export function cooldownRemaining(sentAt) {
    if (!sentAt) return 0
    const elapsed = (Date.now() - new Date(sentAt).getTime()) / 1000
    return Math.max(0, Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed))
}
