import { OAuth2Client } from "google-auth-library";

/**
 * Google Identity Services ID-token verification.
 *
 * The browser runs the "Sign in with Google" button, which hands back a signed
 * ID token (a JWT). The frontend POSTs that to /api/auth/admin/google and this
 * module proves it is genuine before any account is created or logged in.
 *
 * Only GOOGLE_CLIENT_ID is needed - no client secret. The client ID is public
 * by design (it ships in the browser as NEXT_PUBLIC_GOOGLE_CLIENT_ID); the
 * security comes from Google's signature over the token plus the `aud` check
 * below, which is what stops a token minted for some *other* site being
 * replayed at ours.
 *
 * Never trust any field on the token without verifying it here first: an
 * unverified ID token is just attacker-controlled JSON.
 */

// Both spellings are valid in the `iss` claim.
const GOOGLE_ISSUERS = ["accounts.google.com", "https://accounts.google.com"];

export class GoogleAuthError extends Error {
    constructor(code, message, status = 401) {
        super(message);
        this.name = "GoogleAuthError";
        this.code = code;
        this.status = status;
    }
}

/**
 * Accepts a comma-separated list so one backend can serve several origins
 * (web + a future mobile client) without a second deploy.
 */
const audienceList = () =>
    (process.env.GOOGLE_CLIENT_ID || "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);

// The client caches Google's public keys (JWKS) across calls, so it must be a
// singleton - a fresh client per request would refetch the key set every time.
let cachedClient = null;
const getClient = () => {
    if (!cachedClient) cachedClient = new OAuth2Client();
    return cachedClient;
};

/**
 * Verifies a Google ID token and returns only the claims we act on.
 *
 * `verifyIdToken` checks the RSA signature against Google's current keys, that
 * `aud` is one of our client IDs, that `iss` is Google, and that the token is
 * unexpired. It throws on any failure - which is why the catch below is a flat
 * "invalid token" rather than an attempt to explain which check failed.
 *
 * @returns {Promise<{googleId: string, email: string, emailVerified: boolean,
 *                    name: string, picture: string|null, hostedDomain: string|null}>}
 */
export const verifyGoogleIdToken = async (credential) => {
    const audience = audienceList();

    if (audience.length === 0) {
        throw new GoogleAuthError(
            "GOOGLE_NOT_CONFIGURED",
            "Google sign-in is not configured on this server",
            503
        );
    }
    if (typeof credential !== "string" || credential.length === 0) {
        throw new GoogleAuthError("GOOGLE_INVALID_TOKEN", "Missing Google credential", 400);
    }

    let payload;
    try {
        const ticket = await getClient().verifyIdToken({ idToken: credential, audience });
        payload = ticket.getPayload();
    } catch (error) {
        // Includes expired tokens (the credential is short-lived), a mismatched
        // audience, and outright forgeries. Log for ops, stay vague to the client.
        console.error("Google ID token verification failed:", error.message);
        throw new GoogleAuthError(
            "GOOGLE_INVALID_TOKEN",
            "Could not verify your Google sign-in. Please try again.",
            401
        );
    }

    // Defence in depth: the library already asserts `iss`, but this is the one
    // claim that decides whether the signature we just trusted came from Google
    // at all, so it is worth failing loudly on rather than assuming.
    if (!payload || !GOOGLE_ISSUERS.includes(payload.iss)) {
        throw new GoogleAuthError(
            "GOOGLE_INVALID_TOKEN",
            "Could not verify your Google sign-in. Please try again.",
            401
        );
    }

    // `sub` is Google's stable, immutable user id - the only field safe to use
    // as an account key. Email can change on a Google account; sub cannot.
    if (!payload.sub || !payload.email) {
        throw new GoogleAuthError(
            "GOOGLE_INCOMPLETE_PROFILE",
            "Your Google account did not return an email address",
            400
        );
    }

    return {
        googleId: String(payload.sub),
        email: String(payload.email).toLowerCase().trim(),
        emailVerified: payload.email_verified === true,
        name: typeof payload.name === "string" ? payload.name.trim() : "",
        picture: typeof payload.picture === "string" ? payload.picture : null,
        hostedDomain: typeof payload.hd === "string" ? payload.hd : null,
    };
};
