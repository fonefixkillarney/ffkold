import Admin from "../models/auth/admin.js";
import Payment from "../models/Payment.js";
import Transaction from "../models/Transaction.js";
import { activatePlanForAdmin } from "./billing.js";
import { getActivePlanByKey } from "./planConfig.js";
import { sendPaymentReceiptEmail, sendSeatsAddedEmail } from "./resendEmails.js";

/**
 * The single, idempotent success path every non-Paddle provider funnels
 * through once a payment is confirmed (via webhook OR an explicit verify).
 *
 * Idempotency & concurrency: a gateway may deliver its webhook twice AND the
 * user may hit verify at the same moment. `activatePlanForAdmin` RESETS the
 * agent minute cycle, so running it twice would wipe legitimate usage. We
 * therefore claim the created/pending/processing -> success transition with a
 * single atomic conditional update; only the caller that wins the claim
 * activates the plan. Everyone else is a no-op.
 *
 * On a transient failure during activation we roll the claim back to
 * "processing" so the gateway's next retry re-attempts. On a permanent failure
 * (admin or plan gone) we mark the payment failed so retries stop.
 *
 * @returns {{ activated: boolean, alreadyProcessed?: boolean, payment: object }}
 */
export const fulfillSuccessfulPayment = async (paymentId, { providerRef, webhookPayload } = {}) => {
    const now = new Date();

    const claim = await Payment.findOneAndUpdate(
        { _id: paymentId, status: { $nin: ["success", "refunded"] } },
        {
            $set: {
                status: "success",
                paidAt: now,
                ...(providerRef ? { providerRef } : {}),
                ...(webhookPayload ? { webhookPayload } : {}),
            },
        },
        { new: true }
    );

    if (!claim) {
        // Lost the race (or already refunded) - do not re-activate.
        const payment = await Payment.findById(paymentId);
        return { activated: false, alreadyProcessed: true, payment };
    }

    const admin = await Admin.findById(claim.adminId);
    const plan = getActivePlanByKey(claim.planKey);

    if (!admin || !plan) {
        // Permanent failure - stop the gateway retrying forever.
        claim.status = "failed";
        claim.paidAt = null;
        claim.failureReason = !admin
            ? "Admin account no longer exists"
            : "Plan is no longer active";
        await claim.save();
        return { activated: false, payment: claim };
    }

    try {
        await activatePlanForAdmin(admin, plan, { seats: claim.seats, type: claim.type });
    } catch (error) {
        // Transient - release the claim so a retry can re-run activation.
        await Payment.updateOne(
            { _id: claim._id },
            { $set: { status: "processing" }, $unset: { paidAt: 1 } }
        );
        throw error;
    }

    // Mirror into the legacy Transaction collection so the super-admin revenue
    // dashboard (which aggregates Transaction) includes local payments too.
    // Best-effort: activation is the source of truth, so a mirror failure must
    // not 500 the webhook (which would trigger pointless gateway retries).
    try {
        await Transaction.create({
            adminId: claim.adminId,
            planKey: claim.planKey,
            amount: claim.amount,
            currency: claim.currency,
            paddleTransactionId: null,
            seats: claim.seats,
            type: claim.type,
            status: "success",
        });
    } catch (error) {
        console.error("Payment fulfilled but Transaction mirror failed:", claim.orderId, error);
    }

    await notifyAdminOfPayment(admin, plan, claim);

    return { activated: true, payment: claim };
};

/**
 * Confirmation email for whatever the admin just bought. Best-effort by
 * design: the money moved and the plan is live either way, so a mail-provider
 * outage must never turn into a gateway retry loop.
 */
const notifyAdminOfPayment = async (admin, plan, payment) => {
    if (!admin.emailNotificationsEnabled) return;
    try {
        if (payment.type === "seats") {
            await sendSeatsAddedEmail(admin.email, {
                seatsAdded: payment.seats,
                totalSeats: admin.agentLimit,
                amount: payment.amount,
                currency: payment.currency,
            });
        } else {
            await sendPaymentReceiptEmail(admin.email, {
                planName: plan.name,
                seats: payment.seats,
                amount: payment.amount,
                currency: payment.currency,
                orderId: payment.orderId,
                type: payment.type,
            });
        }
    } catch (error) {
        console.error("Payment confirmation email failed:", payment.orderId, error.message);
    }
};

/** Marks a payment as failed/cancelled/expired without touching the plan. */
export const markPaymentUnpaid = async (paymentId, status, reason) => {
    const allowed = ["failed", "cancelled", "expired"];
    const next = allowed.includes(status) ? status : "failed";
    return Payment.findOneAndUpdate(
        // Never overwrite a successful payment with a late failure callback.
        { _id: paymentId, status: { $nin: ["success", "refunded"] } },
        { $set: { status: next, failureReason: reason || null } },
        { new: true }
    );
};
