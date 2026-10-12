import crypto from "crypto"
import bcrypt from "bcryptjs"
import { OAuth2Client } from "google-auth-library"
import jwt from "jsonwebtoken"
import { User } from "../models/User.js"
import { sendVerificationCodeEmail } from "../utils/mailer.js"
import { FIRST_ORDER_DISCOUNT_PERCENT, generateUniquePromoCode } from "../utils/promo.js"
import {
    buildCodeFields,
    buildEmailChangeFields,
    buildResetFields,
    CLEARED_CODE_FIELDS,
    CLEARED_EMAIL_CHANGE_FIELDS,
    CLEARED_RESET_FIELDS,
    compareCode,
    cooldownRemaining,
    generateCode,
    MAX_ATTEMPTS,
    MIN_PASSWORD_LENGTH,
} from "../utils/verification.js"

const TOKEN_EXPIRY = "30d"

// Both signup and signin are two-step: the password step never returns a token,
// only `requiresVerification`. The token is minted exclusively by verifyEmail
// below, once the 4-digit code we mailed comes back.

function signUserToken(user) {
    return jwt.sign({ id: user._id, email: user.email, role: "user" }, process.env.JWT_SECRET, { expiresIn: TOKEN_EXPIRY })
}

// The account's data as the frontend needs it — includes the unique first-order
// promo code so the register screen can show it and checkout can pre-fill it.
function publicUser(user) {
    return {
        id: user._id,
        name: user.name,
        email: user.email,
        promoCode: user.promoCode,
        promoUsed: user.promoUsed,
        promoPercent: FIRST_ORDER_DISCOUNT_PERCENT,
        emailVerified: user.emailVerified,
        orderUpdates: user.orderUpdates,
        saleAlerts: user.saleAlerts,
    }
}

// Mints a code, stores only its hash against the user, and emails the plaintext.
// `{ ok: false }` means we could not get the code to the customer at all.
async function issueCode(user, purpose) {
    const code = generateCode()
    await User.updateOne({ _id: user._id }, { $set: await buildCodeFields(code) })

    const mail = await sendVerificationCodeEmail({ to: user.email, name: user.name, code, purpose })
    if (mail.sent) return { ok: true }

    // Email isn't working (no RESEND_API_KEY yet, or the send failed). Outside
    // production we hand the code back to the caller so the flow stays testable
    // end to end; in production we refuse rather than leak it.
    if (process.env.NODE_ENV === "production") return { ok: false, reason: mail.reason }

    console.warn(`[verify] Email not sent (${mail.reason}) — ${purpose} code for ${user.email} is ${code}`)
    return { ok: true, devCode: code }
}

const MAIL_FAILED = {
    success: false,
    message: "We couldn't send your verification email. Please try again in a moment.",
}

export const registerUser = async (req, res) => {
    try {
        const { name, email, password } = req.body
        if (!name || !email || !password) {
            return res.status(400).json({ success: false, message: "name, email and password are required" })
        }
        // The register form asks for 6 characters via minLength, but the API never
        // checked, so a one-character password was accepted by anything posting
        // here directly. Same floor as the reset endpoint below.
        if (String(password).length < MIN_PASSWORD_LENGTH) {
            return res.status(400).json({
                success: false,
                message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
            })
        }

        const normalized = email.toLowerCase().trim()
        const existing = await User.findOne({ email: normalized })

        // A *verified* account owns its email. An unverified one is just an
        // abandoned signup, so the same address is allowed to start over.
        if (existing?.emailVerified) {
            return res.status(409).json({ success: false, message: "Email already registered" })
        }

        const hashed = await bcrypt.hash(password, 10)
        let user
        if (existing) {
            existing.name = name
            existing.password = hashed
            // Keep the code already minted for this address so a retry doesn't
            // burn a second one.
            if (!existing.promoCode) existing.promoCode = await generateUniquePromoCode()
            user = await existing.save()
        } else {
            user = await User.create({
                name,
                email: normalized,
                password: hashed,
                // Mint this account's own unique first-order code at signup.
                promoCode: await generateUniquePromoCode(),
                promoUsed: false,
                emailVerified: false,
            })
        }

        const issued = await issueCode(user, "register")
        if (!issued.ok) return res.status(502).json(MAIL_FAILED)

        res.status(201).json({
            success: true,
            requiresVerification: true,
            email: user.email,
            devCode: issued.devCode,
        })
    } catch (error) {
        res.status(500).json({ success: false, message: error.message })
    }
}

export const loginUser = async (req, res) => {
    try {
        const { email, password } = req.body
        if (!email || !password) {
            return res.status(400).json({ success: false, message: "email and password are required" })
        }

        const user = await User.findOne({ email: email.toLowerCase().trim() })
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ success: false, message: "Invalid email or password" })
        }

        // Correct password only gets you the code step — never the token.
        const issued = await issueCode(user, "login")
        if (!issued.ok) return res.status(502).json(MAIL_FAILED)

        res.status(200).json({
            success: true,
            requiresVerification: true,
            email: user.email,
            devCode: issued.devCode,
        })
    } catch (error) {
        res.status(500).json({ success: false, message: error.message })
    }
}

// "Sign in / Sign up with Google". The browser gets a Google-signed ID token from
// Google Identity Services and posts it here; verifyIdToken checks Google's
// signature and that it was issued to OUR client id, so the email inside is one
// Google has proven the person owns. That stands in for the emailed 4-digit code,
// which is why this route — unlike /login — mints the token directly.
let googleClient = null
export const googleSignIn = async (req, res) => {
    try {
        const clientId = process.env.GOOGLE_CLIENT_ID
        if (!clientId) {
            return res.status(503).json({ success: false, message: "Google sign-in is not configured" })
        }
        const { credential } = req.body
        if (!credential) return res.status(400).json({ success: false, message: "credential is required" })

        googleClient ??= new OAuth2Client(clientId)
        let payload
        try {
            const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: clientId })
            payload = ticket.getPayload()
        } catch {
            return res.status(401).json({ success: false, message: "Google sign-in failed. Please try again." })
        }
        if (!payload?.email || !payload.email_verified) {
            return res.status(401).json({ success: false, message: "Your Google account's email is not verified" })
        }

        const email = payload.email.toLowerCase().trim()
        const name = (payload.name || email.split("@")[0]).trim()
        // Google accounts have no password here; a random one keeps the schema's
        // required field and can never be guessed (Forgot password still works).
        const unusablePassword = () => bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10)

        let user = await User.findOne({ email })
        let created = false
        if (!user) {
            user = await User.create({
                name,
                email,
                password: await unusablePassword(),
                googleId: payload.sub,
                promoCode: await generateUniquePromoCode(),
                promoUsed: false,
                emailVerified: true,
            })
            created = true
        } else {
            // An UNverified account is an abandoned signup (see registerUser) —
            // whoever typed its password never proved the address, so that
            // password must not survive the real owner arriving via Google.
            if (!user.emailVerified) user.password = await unusablePassword()
            if (!user.promoCode) user.promoCode = await generateUniquePromoCode()
            user.googleId = payload.sub
            user.emailVerified = true
            Object.assign(user, CLEARED_CODE_FIELDS)
            await user.save()
        }

        res.status(200).json({ success: true, token: signUserToken(user), data: publicUser(user), created })
    } catch (error) {
        res.status(500).json({ success: false, message: error.message })
    }
}

// Second step of both flows: trade a valid 4-digit code for the auth token.
export const verifyEmailCode = async (req, res) => {
    try {
        const { email, code } = req.body
        if (!email || !code) {
            return res.status(400).json({ success: false, message: "email and code are required" })
        }

        const user = await User.findOne({ email: email.toLowerCase().trim() })
        if (!user || !user.verificationCodeHash) {
            return res.status(400).json({
                success: false,
                message: "No verification is pending for this email. Please sign in again.",
            })
        }

        if (user.verificationExpires && user.verificationExpires.getTime() < Date.now()) {
            await User.updateOne({ _id: user._id }, { $set: CLEARED_CODE_FIELDS })
            return res.status(410).json({ success: false, message: "That code has expired. Request a new one." })
        }

        if (user.verificationAttempts >= MAX_ATTEMPTS) {
            await User.updateOne({ _id: user._id }, { $set: CLEARED_CODE_FIELDS })
            return res.status(429).json({
                success: false,
                message: "Too many incorrect attempts. Request a new code.",
            })
        }

        if (!(await compareCode(String(code).trim(), user.verificationCodeHash))) {
            const attempts = user.verificationAttempts + 1
            await User.updateOne({ _id: user._id }, { $set: { verificationAttempts: attempts } })
            const left = Math.max(0, MAX_ATTEMPTS - attempts)
            return res.status(401).json({
                success: false,
                message: left > 0
                    ? `Incorrect code — ${left} attempt${left === 1 ? "" : "s"} left.`
                    : "Too many incorrect attempts. Request a new code.",
            })
        }

        // Accepted: mark the address proven and drop the code so it can't be
        // replayed.
        user.emailVerified = true
        Object.assign(user, CLEARED_CODE_FIELDS)
        await user.save()

        res.status(200).json({ success: true, token: signUserToken(user), data: publicUser(user) })
    } catch (error) {
        res.status(500).json({ success: false, message: error.message })
    }
}

export const resendEmailCode = async (req, res) => {
    try {
        const { email } = req.body
        if (!email) return res.status(400).json({ success: false, message: "email is required" })

        const user = await User.findOne({ email: email.toLowerCase().trim() })
        // Deliberately vague: this endpoint must not reveal which addresses have
        // accounts or pending codes.
        if (!user || !user.verificationCodeHash) {
            return res.status(200).json({
                success: true,
                message: "If a verification is pending for that address, a new code is on its way.",
            })
        }

        const wait = cooldownRemaining(user.verificationSentAt)
        if (wait > 0) {
            return res.status(429).json({
                success: false,
                message: `Please wait ${wait}s before requesting another code.`,
            })
        }

        const issued = await issueCode(user, user.emailVerified ? "login" : "register")
        if (!issued.ok) return res.status(502).json(MAIL_FAILED)

        res.status(200).json({ success: true, email: user.email, devCode: issued.devCode })
    } catch (error) {
        res.status(500).json({ success: false, message: error.message })
    }
}

// ── Password reset ───────────────────────────────────────────────────────────
//
// Two steps, mirroring the login/register pair above:
//   POST /forgot-password  { email }                   -> mails a 4-digit code
//   POST /reset-password   { email, code, password }    -> sets it, returns token
//
// The code lives in the reset* fields, NOT the verification* ones — see the note
// in models/User.js. That separation is load-bearing: a reset code is issued on
// an email address alone, so if /verify could accept it, anyone able to trigger a
// reset would get a token without ever knowing a password.

// Mints a reset code, stores only its hash, and emails the plaintext.
async function issueResetCode(user) {
    const code = generateCode()
    await User.updateOne({ _id: user._id }, { $set: await buildResetFields(code) })

    const mail = await sendVerificationCodeEmail({ to: user.email, name: user.name, code, purpose: "reset" })
    if (mail.sent) return { ok: true }

    if (process.env.NODE_ENV === "production") return { ok: false, reason: mail.reason }

    console.warn(`[verify] Email not sent (${mail.reason}) — reset code for ${user.email} is ${code}`)
    return { ok: true, devCode: code }
}

// Deliberately identical for every address, whether or not an account exists.
// Anything that varied by account — a 404, a different message, even a
// noticeably faster reply — would turn this endpoint into a way to test which
// email addresses have accounts here.
const RESET_SENT = {
    success: true,
    message: "If that email has an account, a reset code is on its way.",
}

export const forgotPassword = async (req, res) => {
    try {
        const { email } = req.body
        if (!email) return res.status(400).json({ success: false, message: "email is required" })

        const user = await User.findOne({ email: email.toLowerCase().trim() })
        if (!user) return res.status(200).json(RESET_SENT)

        // The cooldown is reported as success too: "please wait 20s" would confirm
        // the account exists just as loudly as a 404 does.
        if (cooldownRemaining(user.resetSentAt) > 0) return res.status(200).json(RESET_SENT)

        const issued = await issueResetCode(user)
        if (!issued.ok) return res.status(502).json(MAIL_FAILED)

        // devCode only ever comes back when mail is unconfigured outside
        // production (issueResetCode refuses to leak it otherwise), and it is the
        // one thing here that does reveal the address exists — which is exactly
        // what makes the flow testable without a mail transport.
        res.status(200).json({ ...RESET_SENT, devCode: issued.devCode })
    } catch (error) {
        res.status(500).json({ success: false, message: error.message })
    }
}

export const resetPassword = async (req, res) => {
    try {
        const { email, code, password } = req.body
        if (!email || !code || !password) {
            return res.status(400).json({ success: false, message: "email, code and password are required" })
        }
        if (String(password).length < MIN_PASSWORD_LENGTH) {
            return res.status(400).json({
                success: false,
                message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
            })
        }

        const user = await User.findOne({ email: email.toLowerCase().trim() })
        if (!user || !user.resetCodeHash) {
            return res.status(400).json({
                success: false,
                message: "No password reset is pending for this email. Request a new code.",
            })
        }

        if (user.resetExpires && user.resetExpires.getTime() < Date.now()) {
            await User.updateOne({ _id: user._id }, { $set: CLEARED_RESET_FIELDS })
            return res.status(410).json({ success: false, message: "That code has expired. Request a new one." })
        }

        if (user.resetAttempts >= MAX_ATTEMPTS) {
            await User.updateOne({ _id: user._id }, { $set: CLEARED_RESET_FIELDS })
            return res.status(429).json({
                success: false,
                message: "Too many incorrect attempts. Request a new code.",
            })
        }

        if (!(await compareCode(String(code).trim(), user.resetCodeHash))) {
            const attempts = user.resetAttempts + 1
            await User.updateOne({ _id: user._id }, { $set: { resetAttempts: attempts } })
            const left = Math.max(0, MAX_ATTEMPTS - attempts)
            return res.status(401).json({
                success: false,
                message: left > 0
                    ? `Incorrect code — ${left} attempt${left === 1 ? "" : "s"} left.`
                    : "Too many incorrect attempts. Request a new code.",
            })
        }

        user.password = await bcrypt.hash(password, 10)
        // Receiving the code proves the address, so an account that never
        // finished signup is verified by getting through this.
        user.emailVerified = true
        // Both code sets are dropped: the reset code so it cannot be replayed,
        // and any pending LOGIN code because the password it was issued against
        // no longer exists.
        Object.assign(user, CLEARED_RESET_FIELDS, CLEARED_CODE_FIELDS)
        await user.save()

        // Signed in directly, the same way verifyEmailCode does it — the customer
        // has just proven both the address and a new password, so bouncing them
        // back to a login form would only ask for what they have already given.
        res.status(200).json({ success: true, token: signUserToken(user), data: publicUser(user) })
    } catch (error) {
        res.status(500).json({ success: false, message: error.message })
    }
}

// Not .lean(): a hydrated document gets schema defaults filled in, so accounts
// created before orderUpdates/saleAlerts existed still report them. Every code
// hash is excluded — a 4-digit code's bcrypt hash can be brute-forced offline in
// minutes, which for the email-change code would let a customer claim an address
// they never received the code at.
export const getUserMe = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select(
            "-password -verificationCodeHash -verificationExpires -verificationAttempts -verificationSentAt" +
                " -resetCodeHash -resetExpires -resetAttempts -resetSentAt" +
                " -emailChangeCodeHash -emailChangeExpires -emailChangeAttempts -emailChangeSentAt",
        )
        if (!user) return res.status(404).json({ success: false, message: "User not found" })
        res.status(200).json({ success: true, data: user })
    } catch (error) {
        res.status(500).json({ success: false, message: error.message })
    }
}

// ── Account settings (/user/settings) ───────────────────────────────────────

const MAX_NAME_LENGTH = 80
// Deliberately loose — the code we mail is the real check that the address works.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// PATCH /api/user/me — { name?, orderUpdates?, saleAlerts? }. Only the fields
// sent are changed. Email is not accepted here: it moves through the two-step
// requestEmailChange / confirmEmailChange pair below.
export const updateUserMe = async (req, res) => {
    try {
        const { name, orderUpdates, saleAlerts } = req.body ?? {}
        const set = {}

        if (name !== undefined) {
            const trimmed = String(name).trim()
            if (!trimmed) return res.status(400).json({ success: false, message: "Name can't be empty" })
            if (trimmed.length > MAX_NAME_LENGTH) {
                return res.status(400).json({
                    success: false,
                    message: `Name must be ${MAX_NAME_LENGTH} characters or fewer`,
                })
            }
            set.name = trimmed
        }

        for (const [key, value] of Object.entries({ orderUpdates, saleAlerts })) {
            if (value === undefined) continue
            if (typeof value !== "boolean") {
                return res.status(400).json({ success: false, message: `${key} must be true or false` })
            }
            set[key] = value
        }

        const user = await User.findByIdAndUpdate(req.user.id, { $set: set }, { new: true })
        if (!user) return res.status(404).json({ success: false, message: "User not found" })
        res.status(200).json({ success: true, data: publicUser(user) })
    } catch (error) {
        res.status(500).json({ success: false, message: error.message })
    }
}

// Mints an email-change code, stores only its hash, and mails the plaintext to
// the NEW address.
async function issueEmailChangeCode(user, pendingEmail) {
    const code = generateCode()
    await User.updateOne({ _id: user._id }, { $set: await buildEmailChangeFields(code, pendingEmail) })

    const mail = await sendVerificationCodeEmail({ to: pendingEmail, name: user.name, code, purpose: "email-change" })
    if (mail.sent) return { ok: true }

    if (process.env.NODE_ENV === "production") return { ok: false, reason: mail.reason }

    console.warn(`[verify] Email not sent (${mail.reason}) — email-change code for ${pendingEmail} is ${code}`)
    return { ok: true, devCode: code }
}

// POST /api/user/email-change — { email }. Step 1: mails a code to the new
// address and changes nothing else. Calling it again is the resend.
export const requestEmailChange = async (req, res) => {
    try {
        const email = String(req.body?.email ?? "").toLowerCase().trim()
        if (!EMAIL_PATTERN.test(email)) {
            return res.status(400).json({ success: false, message: "Enter a valid email address" })
        }

        const user = await User.findById(req.user.id)
        if (!user) return res.status(404).json({ success: false, message: "User not found" })
        if (email === user.email) {
            return res.status(400).json({ success: false, message: "That's already your email address" })
        }

        // Same ownership rule as registerUser: a verified account owns its
        // address, an unverified one is an abandoned signup and doesn't block.
        // (Says no more about which addresses have accounts than /register does.)
        if (await User.exists({ email, emailVerified: true })) {
            return res.status(409).json({ success: false, message: "That email is already used by another account" })
        }

        const wait = cooldownRemaining(user.emailChangeSentAt)
        if (wait > 0) {
            return res.status(429).json({
                success: false,
                message: `Please wait ${wait}s before requesting another code.`,
            })
        }

        const issued = await issueEmailChangeCode(user, email)
        if (!issued.ok) return res.status(502).json(MAIL_FAILED)

        res.status(200).json({ success: true, email, devCode: issued.devCode })
    } catch (error) {
        res.status(500).json({ success: false, message: error.message })
    }
}

// POST /api/user/email-change/verify — { code }. Step 2: moves the account onto
// the pending address. Returns a fresh token, since the old one names the old
// address.
export const confirmEmailChange = async (req, res) => {
    try {
        const { code } = req.body ?? {}
        if (!code) return res.status(400).json({ success: false, message: "code is required" })

        const user = await User.findById(req.user.id)
        if (!user || !user.pendingEmail || !user.emailChangeCodeHash) {
            return res.status(400).json({
                success: false,
                message: "No email change is pending. Request a new code.",
            })
        }

        if (user.emailChangeExpires && user.emailChangeExpires.getTime() < Date.now()) {
            await User.updateOne({ _id: user._id }, { $set: CLEARED_EMAIL_CHANGE_FIELDS })
            return res.status(410).json({ success: false, message: "That code has expired. Request a new one." })
        }

        if (user.emailChangeAttempts >= MAX_ATTEMPTS) {
            await User.updateOne({ _id: user._id }, { $set: CLEARED_EMAIL_CHANGE_FIELDS })
            return res.status(429).json({
                success: false,
                message: "Too many incorrect attempts. Request a new code.",
            })
        }

        if (!(await compareCode(String(code).trim(), user.emailChangeCodeHash))) {
            const attempts = user.emailChangeAttempts + 1
            await User.updateOne({ _id: user._id }, { $set: { emailChangeAttempts: attempts } })
            const left = Math.max(0, MAX_ATTEMPTS - attempts)
            return res.status(401).json({
                success: false,
                message: left > 0
                    ? `Incorrect code — ${left} attempt${left === 1 ? "" : "s"} left.`
                    : "Too many incorrect attempts. Request a new code.",
            })
        }

        // Re-checked here: another account may have verified this address since
        // the code went out.
        const holder = await User.findOne({ email: user.pendingEmail, _id: { $ne: user._id } })
        if (holder?.emailVerified) {
            await User.updateOne({ _id: user._id }, { $set: CLEARED_EMAIL_CHANGE_FIELDS })
            return res.status(409).json({ success: false, message: "That email is already used by another account" })
        }
        // The customer has just proven they read this inbox, so an unfinished
        // signup sitting on the address was theirs or someone typing their
        // address — either way it gives way (the unique index would refuse the
        // move otherwise), exactly as registerUser lets it be started over.
        if (holder) await User.deleteOne({ _id: holder._id })

        user.email = user.pendingEmail
        user.emailVerified = true
        // Any login or reset code still pending was mailed to the OLD address,
        // so it must not outlive the move.
        Object.assign(user, CLEARED_EMAIL_CHANGE_FIELDS, CLEARED_CODE_FIELDS, CLEARED_RESET_FIELDS)
        await user.save()

        res.status(200).json({ success: true, token: signUserToken(user), data: publicUser(user) })
    } catch (error) {
        // Lost a race with a signup on the same address between the check and
        // the save.
        if (error?.code === 11000) {
            return res.status(409).json({ success: false, message: "That email is already used by another account" })
        }
        res.status(500).json({ success: false, message: error.message })
    }
}
