import { Resend } from 'resend';
import dotenv from 'dotenv';
dotenv.config();

const primaryClientUrl = (process.env.CLIENT_URL || 'http://localhost:3000')
    .split(',')[0]
    .trim();

let resendClient = null;
const getResend = () => {
    if (!resendClient) {
        if (!process.env.RESEND_API_KEY) {
            throw new Error('RESEND_API_KEY is not configured');
        }
        resendClient = new Resend(process.env.RESEND_API_KEY);
    }
    return resendClient;
};

/**
 * The `from` header, resolved ONCE from EMAIL_FROM.
 *
 * EMAIL_FROM is accepted in either shape a human might write it:
 *   contact@example.com                  -> "Brand <contact@example.com>"
 *   Reach Calls <contact@example.com>    -> used verbatim
 *
 * Every call site used to interpolate EMAIL_FROM into its own
 * `"Name <...>"` template, which produced nested angle brackets
 * (`Name <Reach Calls <contact@example.com>>`) whenever EMAIL_FROM already
 * carried a display name - Resend rejects that with a 422 "Invalid `from`
 * field". Building it in one place makes that shape unrepresentable.
 *
 * EMAIL_FROM_NAME overrides the display name used for a bare address.
 */
const EMAIL_ADDRESS = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const NAMED_ADDRESS = /^[^<>]+<\s*([^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)\s*>$/;

let cachedFrom = null;
const getFromAddress = () => {
    if (cachedFrom) return cachedFrom;

    const configured = (process.env.EMAIL_FROM || '').trim();
    if (!configured) {
        throw new Error(
            'EMAIL_FROM is not configured. Set it to "contact@yourdomain.com" or ' +
            '"Your Brand <contact@yourdomain.com>" using a domain verified in Resend.'
        );
    }

    if (NAMED_ADDRESS.test(configured)) {
        // Already "Name <addr>" - trust it, but strip any quotes around the
        // display name. Resend's validator rejects the quoted RFC 5322 form.
        cachedFrom = configured.replace(/^"(.*)"(\s*<)/, '$1$2');
        return cachedFrom;
    }

    if (EMAIL_ADDRESS.test(configured)) {
        const brand = (process.env.EMAIL_FROM_NAME || 'Enter Dial Team').trim();
        cachedFrom = `${brand} <${configured}>`;
        return cachedFrom;
    }

    throw new Error(
        `EMAIL_FROM is malformed: "${configured}". Use "contact@yourdomain.com" ` +
        'or "Your Brand <contact@yourdomain.com>".'
    );
};

export const handMadeEmail = async (email, code, subject, text) => {
    try {
        const { data, error } = await getResend().emails.send({
            from: getFromAddress(), // Use your verified domain email
            to: [email],
            subject,
            text: `${text}\n\nVerification Code: ${code}`,
        });

        if (error) {
            console.error('❌ Resend error:', error);
            throw error;
        }

        console.log("✅ Email sent:", data?.id);
        return data;
    } catch (error) {
        console.error('❌ Email send error:', error);
        throw new Error("Email could not be sent");
    }
};

// Verification email function.
//
// `purpose` picks the copy: the same code is emailed when an account is first
// created and every time someone signs in, and greeting a returning admin with
// "Welcome to Enter Dial!" on their third sign-in of the day reads as a
// phishing attempt rather than a security step. Defaults to the signup wording
// so existing callers are unchanged.
export const sendVerificationEmail = async (email, code, purpose = "signup") => {
    const isLogin = purpose === "login";
    const subject = isLogin ? 'Your Enter Dial sign-in code' : 'Verify Your Email';
    const heading = isLogin ? 'Finish signing in' : 'Welcome to Enter Dial!';
    const intro = isLogin
        ? 'Enter this code to finish signing in to Enter Dial:'
        : 'Below is your verification email code:';
    const outro = isLogin
        ? "If you didn't try to sign in, someone may have your password - change it now."
        : '';

    try {
        const { data, error } = await getResend().emails.send({
            from: getFromAddress(), // Use your verified domain email
            to: [email],
            subject,
            html: `<div style="font-family: Arial, sans-serif; text-align: center; padding: 20px; background-color: #f4f4f4;">
        <h1>${heading}</h1>
        <p>${intro}</p>
           <h3>${code}</h3>
           <p>Note!! This code will expire in 10 minutes.</p>
           ${outro ? `<p>${outro}</p>` : ''}
        </div>`,
        });

        if (error) {
            console.error('❌ Resend error:', error);
            throw error;
        }

        console.log("✅ Verification email sent:", data?.id);
        return data;
    } catch (error) {
        console.error('❌ Email send error:', error);
        throw new Error("Verification email could not be sent");
    }
};

// Password reset email
export const sendPasswordResetEmail = async (email, token, role) => {
    const resetUrl = `${primaryClientUrl}/reset-password?role=${role}&token=${token}`;
    try {
        const { data, error } = await getResend().emails.send({
            from: getFromAddress(),
            to: [email],
            subject: 'Reset your password',
            html: `<div style="font-family: Arial, sans-serif; text-align: center; padding: 20px; background-color: #f4f4f4;">
        <h1>Reset your Enter Dial password</h1>
        <p>Click the button below to choose a new password. This link expires in 30 minutes.</p>
        <p><a href="${resetUrl}" style="display:inline-block;padding:12px 24px;background:#4f46e5;color:#fff;border-radius:8px;text-decoration:none;">Reset Password</a></p>
        <p>If you didn't request this, you can safely ignore this email.</p>
        </div>`,
        });

        if (error) {
            console.error('❌ Resend error:', error);
            throw error;
        }

        console.log("✅ Password reset email sent:", data?.id);
        return data;
    } catch (error) {
        console.error('❌ Email send error:', error);
        throw new Error("Password reset email could not be sent");
    }
};

// Agent invitation email
export const sendAgentInvitationEmail = async (email, { password, assignedNumber }) => {
    const loginUrl = `${primaryClientUrl}/agent-login`;
    try {
        const { data, error } = await getResend().emails.send({
            from: getFromAddress(),
            to: [email],
            subject: "You've been invited to Enter Dial",
            html: `<div style="font-family: Arial, sans-serif; text-align: center; padding: 20px; background-color: #f4f4f4;">
        <h1>Welcome to Enter Dial</h1>
        <p>You've been invited to join your team's dialer.</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Password:</strong> ${password}</p>
        <p><strong>Assigned number:</strong> ${assignedNumber}</p>
        <p><a href="${loginUrl}" style="display:inline-block;padding:12px 24px;background:#4f46e5;color:#fff;border-radius:8px;text-decoration:none;">Go to Dial Pad</a></p>
        </div>`,
        });

        if (error) {
            console.error('❌ Resend error:', error);
            throw error;
        }

        console.log("✅ Agent invitation email sent:", data?.id);
        return data;
    } catch (error) {
        console.error('❌ Email send error:', error);
        throw new Error("Agent invitation email could not be sent");
    }
};

const money = (amount, currency) => {
    try {
        return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
    } catch {
        return `${amount} ${currency}`;
    }
};

// Payment/plan amounts are stored in minor units everywhere in this codebase.
const moneyMinor = (minor, currency) => money((minor ?? 0) / 100, currency);

const PANEL_URL = `${primaryClientUrl}/admin`;

const TYPE_HEADLINE = {
    new: "Your plan is live",
    renew: "Your plan has been renewed",
    upgrade: "Your plan has been upgraded",
    downgrade: "Your plan has been changed",
};

// Receipt for a plan purchase / renewal / upgrade.
export const sendPaymentReceiptEmail = async (
    email,
    { planName, seats, amount, currency, orderId, type }
) => {
    const headline = TYPE_HEADLINE[type] || "Payment received";
    return TextMailor({
        to: email,
        subject: `${headline} — ${planName}`,
        html: `<div style="font-family: Arial, sans-serif; padding: 24px; background-color: #f4f4f4;">
        <h1 style="margin-top:0;">${headline} 🎉</h1>
        <p>Thank you — your payment has been confirmed and your account is ready.</p>
        <table style="border-collapse:collapse;margin:16px 0;">
          <tr><td style="padding:4px 16px 4px 0;"><strong>Plan</strong></td><td>${planName}</td></tr>
          <tr><td style="padding:4px 16px 4px 0;"><strong>Seats</strong></td><td>${seats}</td></tr>
          <tr><td style="padding:4px 16px 4px 0;"><strong>Amount</strong></td><td>${moneyMinor(amount, currency)}</td></tr>
          <tr><td style="padding:4px 16px 4px 0;"><strong>Order</strong></td><td>${orderId}</td></tr>
        </table>
        <p>Your next step is to buy a phone number, then assign it to an agent.</p>
        <p><a href="${primaryClientUrl}/admin/buy-number" style="display:inline-block;padding:12px 24px;background:#4f46e5;color:#fff;border-radius:8px;text-decoration:none;">Buy your first number</a></p>
        </div>`,
    });
};

// Extra seats bought from inside the admin panel.
export const sendSeatsAddedEmail = async (
    email,
    { seatsAdded, totalSeats, amount, currency }
) => {
    return TextMailor({
        to: email,
        subject: `${seatsAdded} more seat${seatsAdded === 1 ? "" : "s"} added to your account`,
        html: `<div style="font-family: Arial, sans-serif; padding: 24px; background-color: #f4f4f4;">
        <h1 style="margin-top:0;">Seats added ✅</h1>
        <p>We received your payment of <strong>${moneyMinor(amount, currency)}</strong> and added
        <strong>${seatsAdded}</strong> seat${seatsAdded === 1 ? "" : "s"} to your account.</p>
        <p>You now have <strong>${totalSeats}</strong> seat${totalSeats === 1 ? "" : "s"} in total.
        Your billing cycle and every agent's minutes are unchanged.</p>
        <p><a href="${primaryClientUrl}/admin/invite-agents" style="display:inline-block;padding:12px 24px;background:#4f46e5;color:#fff;border-radius:8px;text-decoration:none;">Add your agents</a></p>
        </div>`,
    });
};

// A number was purchased and is ready to be assigned.
export const sendNumberPurchasedEmail = async (email, { number, region }) => {
    return TextMailor({
        to: email,
        subject: `Your new number ${number} is ready`,
        html: `<div style="font-family: Arial, sans-serif; padding: 24px; background-color: #f4f4f4;">
        <h1 style="margin-top:0;">Number purchased 📞</h1>
        <p><strong>${number}</strong> (${region}) is now on your account and ready to assign.</p>
        <p>Assign it to an agent to let them start making and receiving calls.</p>
        <p><a href="${primaryClientUrl}/admin/invite-agents" style="display:inline-block;padding:12px 24px;background:#4f46e5;color:#fff;border-radius:8px;text-decoration:none;">Assign this number</a></p>
        </div>`,
    });
};

// Confirmation to the ADMIN that an agent was added (the agent gets their own
// invitation email with credentials).
export const sendAgentAddedEmail = async (
    email,
    { agentName, agentEmail, assignedNumber, seatsUsed, seatsTotal }
) => {
    return TextMailor({
        to: email,
        subject: `${agentName} was added to your team`,
        html: `<div style="font-family: Arial, sans-serif; padding: 24px; background-color: #f4f4f4;">
        <h1 style="margin-top:0;">Agent added</h1>
        <p><strong>${agentName}</strong> (${agentEmail}) now has access to your dialer on
        <strong>${assignedNumber}</strong>. Their sign-in details have been emailed to them.</p>
        <p>Seats used: <strong>${seatsUsed} of ${seatsTotal}</strong>.</p>
        <p><a href="${PANEL_URL}" style="display:inline-block;padding:12px 24px;background:#4f46e5;color:#fff;border-radius:8px;text-decoration:none;">Open your dashboard</a></p>
        </div>`,
    });
};

// Telnyx balance is at/below the alert threshold. Sent to the super admin so
// they top up before call service is affected. (Emitted with a cooldown by
// utils/telnyxMonitor.js so the super admin isn't spammed.)
export const sendTelnyxLowBalanceEmail = async (email, { balance, currency, threshold }) => {
    return TextMailor({
        to: email,
        subject: `⚠️ Telnyx balance low — ${money(balance, currency)} remaining`,
        html: `<div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f4f4f4;">
        <h1 style="color:#b91c1c;">Telnyx balance is low</h1>
        <p>Your Telnyx account balance is <strong>${money(balance, currency)}</strong>, at or below the
        <strong>${money(threshold, currency)}</strong> alert threshold.</p>
        <p>All customer call minutes are drawn from this account. New paid plans will be
        <strong>purchased successfully but held as "pending activation"</strong> (their 30-day cycle will not
        start) until the balance is topped up.</p>
        <p><strong>Please recharge your Telnyx account now</strong> to keep service running and to
        auto-activate any pending subscriptions.</p>
        </div>`,
    });
};

// Balance is being consumed fast enough to run out soon. Separate from the
// low-balance alert so a sudden spike in usage is flagged even above threshold.
export const sendTelnyxBurnRateEmail = async (email, { balance, currency, ratePerHour, hoursRemaining }) => {
    return TextMailor({
        to: email,
        subject: `🔥 Telnyx balance draining fast — ~${Math.max(0, Math.floor(hoursRemaining))}h left`,
        html: `<div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f4f4f4;">
        <h1 style="color:#b91c1c;">Telnyx balance is draining quickly</h1>
        <p>Current balance: <strong>${money(balance, currency)}</strong>.</p>
        <p>Recent usage is about <strong>${money(ratePerHour, currency)}/hour</strong>, which at the current rate
        would exhaust the balance in roughly <strong>${Math.max(0, Math.floor(hoursRemaining))} hour(s)</strong>.</p>
        <p>This is likely high concurrent usage across multiple admins and their agents.
        <strong>We recommend recharging immediately</strong> to avoid call interruptions.</p>
        </div>`,
    });
};

// A previously deferred (pending) plan has been activated now that Telnyx is
// funded again - lets the admin know their subscription clock has started.
export const sendPlanActivatedEmail = async (email, { planName }) => {
    return TextMailor({
        to: email,
        subject: "Your Enter Dial plan is now active",
        html: `<div style="font-family: Arial, sans-serif; text-align: center; padding: 20px; background-color: #f4f4f4;">
        <h1>Your plan is now active 🎉</h1>
        <p>Your <strong>${planName}</strong> subscription has started and your 30-day billing cycle is now running.</p>
        <p>Your agents can start making calls right away.</p>
        </div>`,
    });
};

// Generic text mailer (your existing function)
const TextMailor = async ({ to, subject, text, html }) => {
    try {
        const { data, error } = await getResend().emails.send({
            from: getFromAddress(), // Use your verified domain email
            to: [to],
            subject,
            text,
            html,
        });

        if (error) {
            console.error('❌ Resend error:', error);
            throw error;
        }

        console.log("✅ Email sent:", data?.id);
        return data;
    } catch (error) {
        console.error('❌ Email send error:', error);
        throw new Error("Email could not be sent");
    }
};

export default TextMailor;
