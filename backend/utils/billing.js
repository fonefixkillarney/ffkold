import Agent from "../models/auth/agent.js";
import Admin from "../models/auth/admin.js";
import CallRecord from "../models/CallRecord.js";
import { getActivePlanByKey } from "./planConfig.js";
import { getBalanceStatus, notifySuperAdminLowBalance } from "./telnyxMonitor.js";
import { pruneAgentCallHistory } from "./callHistory.js";
import { sendPlanActivatedEmail } from "./resendEmails.js";
import { isTestAgent } from "./testAgent.js";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** Milliseconds still owed on an admin's current cycle, 0 if none. */
const remainingCycleMs = (admin, now) => {
    if (admin.planStatus !== "active" || !admin.planEndDate) return 0;
    return Math.max(0, admin.planEndDate.getTime() - now.getTime());
};

/**
 * Starts (or restarts) the plan clock: opens a fresh 30-day window and resets
 * every existing agent's cycle to it. Unused minutes never roll over. This is
 * the pure activation with NO Telnyx-balance gating - used both by the gated
 * activatePlanForAdmin and by the monitor when a deferred plan finally gets
 * funded.
 *
 * @param {number} seats     Seats the payment bought. Falls back to the plan
 *                           minimum, or to what the admin already had.
 * @param {number} carryOverMs
 *        Unused time from the plan being replaced, added on top of the new
 *        30 days. This is what makes a Basic -> Professional upgrade
 *        non-punitive: the days already paid for are not thrown away.
 */
export const startPlanClock = async (
    admin,
    plan,
    { seats, carryOverMs = 0, now = new Date() } = {}
) => {
    const planEndDate = new Date(now.getTime() + THIRTY_DAYS_MS + carryOverMs);
    const seatCount = Math.max(1, seats || admin.agentLimit || plan.minAgents);

    admin.planKey = plan.key;
    admin.planStatus = "active";
    admin.planStartDate = now;
    admin.planEndDate = planEndDate;
    admin.agentLimit = seatCount;
    admin.minutesPerAgent = plan.minutesPerUser;
    await admin.save();

    await Agent.updateMany(
        { adminId: admin._id },
        {
            $set: {
                minuteAllocation: plan.minutesPerUser,
                minutesUsed: 0,
                cycleStart: now,
                cycleEnd: planEndDate,
            },
        }
    );

    return admin;
};

/**
 * Adds paid-for seats to a plan that is already running.
 *
 * Deliberately NOT a plan activation: the billing cycle, the minute pools, and
 * every agent's usage are left exactly as they are. An admin buying their
 * 40th seat mid-month must not have the other 39 agents' minutes wiped.
 */
export const addSeatsForAdmin = async (admin, seats) => {
    const added = Math.max(1, Math.floor(seats));
    await Admin.updateOne({ _id: admin._id }, { $inc: { agentLimit: added } });
    admin.agentLimit = (admin.agentLimit || 0) + added;
    return { admin, added };
};

/**
 * Activates a plan for an admin after a successful payment - the single point
 * every gateway (Paddle, Easypaisa, NayaPay) funnels through.
 *
 * Because every customer's call minutes are drawn from the Super Admin's ONE
 * Telnyx account, we gate a brand-new activation on that account having enough
 * balance to actually service calls:
 *   - Balance OK (or unknown): start the 30-day clock immediately.
 *   - Balance too low AND this is a FRESH start (admin not currently active):
 *     the payment still succeeded, but we hold the plan as "pending_activation"
 *     (clock NOT started) and email the super admin to recharge. The monitor
 *     flips it to active automatically once funded.
 *   - Balance too low but the admin is ALREADY active (renew/upgrade): keep
 *     them running - pausing a live subscription would be worse - and just
 *     alert the super admin.
 *
 * Fail-safe: any error determining the balance is treated as "sufficient" so a
 * monitoring outage can never block a paying customer.
 *
 * @returns {{ admin, deferred: boolean, seats: number, status }}
 */
export const activatePlanForAdmin = async (admin, plan, { seats, type } = {}) => {
    const now = new Date();
    const wasActive =
        admin.planStatus === "active" &&
        admin.planEndDate &&
        admin.planEndDate.getTime() > now.getTime();

    // A seat top-up never touches the cycle - handle it before anything else.
    if (type === "seats") {
        const result = await addSeatsForAdmin(admin, seats || 1);
        return { admin: result.admin, deferred: false, seats: result.added, status: null };
    }

    const seatCount = Math.max(1, seats || plan.minAgents);
    // Upgrading mid-cycle keeps the time already paid for. Renewing the same
    // plan does not stack - that would let someone bank a decade of service.
    const carryOverMs = wasActive && admin.planKey !== plan.key ? remainingCycleMs(admin, now) : 0;

    let status = { checked: false, sufficient: true };
    try {
        status = await getBalanceStatus();
    } catch (error) {
        console.error("Telnyx balance check failed during activation:", error.message);
    }

    const shouldDefer = status.checked && !status.sufficient && !wasActive;

    if (shouldDefer) {
        admin.planKey = plan.key;
        admin.planStatus = "pending_activation";
        admin.planStartDate = null;
        admin.planEndDate = null;
        admin.agentLimit = seatCount;
        admin.minutesPerAgent = plan.minutesPerUser;
        await admin.save();

        try {
            await notifySuperAdminLowBalance(status);
        } catch (error) {
            console.error("Low-balance notify failed:", error.message);
        }
        return { admin, deferred: true, seats: seatCount, status };
    }

    await startPlanClock(admin, plan, { seats: seatCount, carryOverMs, now });

    if (status.checked && !status.sufficient) {
        try {
            await notifySuperAdminLowBalance(status);
        } catch (error) {
            console.error("Low-balance notify failed:", error.message);
        }
    }
    return { admin, deferred: false, seats: seatCount, status };
};

/**
 * Activates every plan currently held as "pending_activation" once the Telnyx
 * balance is healthy again. Called by the balance monitor after each sample.
 */
export const activatePendingPlansIfFunded = async (status) => {
    if (!status?.checked || !status.sufficient) return { activated: 0 };

    const pendingAdmins = await Admin.find({ planStatus: "pending_activation" });
    let activated = 0;

    for (const admin of pendingAdmins) {
        const plan = getActivePlanByKey(admin.planKey);
        if (!plan) continue; // plan config no longer active - leave pending
        // agentLimit was already set to the paid-for seat count when the plan
        // was deferred, so it carries straight through.
        await startPlanClock(admin, plan, { seats: admin.agentLimit });
        activated += 1;
        if (admin.emailNotificationsEnabled) {
            try {
                await sendPlanActivatedEmail(admin.email, { planName: plan.name });
            } catch (error) {
                console.error("Plan-activated email failed:", error.message);
            }
        }
    }

    return { activated };
};

/**
 * A plan change must never silently deactivate agents - the caller has to
 * surface this to the admin and get explicit confirmation first.
 *
 * With seat-based billing the constraint is the seat count being purchased,
 * not the tier, so the seat count is what gets compared.
 */
export const wouldChangeExceedAgentLimit = async (admin, seats) => {
    const activeAgentCount = await Agent.countDocuments({
        adminId: admin._id,
        status: { $ne: "suspended" },
    });
    return { wouldExceedAgentLimit: activeAgentCount > seats, activeAgentCount };
};

export const checkCanDial = (agent, admin) => {
    // The test agent dials unlimited: no plan, minute-pool, or status gate at
    // all, because its calls are paid for straight out of the Telnyx account
    // rather than out of a customer's plan. See utils/testAgent.js.
    if (isTestAgent(agent)) {
        return { allowed: true, reason: null };
    }
    if (agent.status !== "active") {
        return { allowed: false, reason: "SUSPENDED" };
    }
    // Paid but held because the Super Admin's Telnyx balance was too low to
    // start service - the 30-day clock hasn't begun, so no dialing yet.
    if (admin && admin.planStatus === "pending_activation") {
        return { allowed: false, reason: "PLAN_PENDING" };
    }
    if (!admin || !admin.planEndDate || admin.planEndDate.getTime() < Date.now()) {
        return { allowed: false, reason: "PLAN_EXPIRED" };
    }
    if (agent.minutesRemaining <= 0) {
        return { allowed: false, reason: "NO_MINUTES" };
    }
    return { allowed: true, reason: null };
};

export const computeBilledMinutes = (durationSeconds, status) => {
    if (status !== "connected") return 0;
    return Math.max(1, Math.ceil(durationSeconds / 60));
};

/**
 * Writes the CallRecord and, for connected calls, deducts the billed
 * minutes from the calling agent's isolated pool. Called from Single Wire's
 * call-ended event - never from anything client-controlled.
 */
export const recordBilledCall = async ({
    agent,
    admin,
    fromNumber,
    toNumber,
    direction,
    status,
    startTime,
    endTime,
    costType,
    sourceCallId = null,
}) => {
    const durationSeconds =
        status === "connected" && endTime
            ? Math.max(0, Math.round((endTime.getTime() - startTime.getTime()) / 1000))
            : 0;
    const billedMinutes = computeBilledMinutes(durationSeconds, status);

    const callRecord = await CallRecord.create({
        agentId: agent._id,
        adminId: admin._id,
        fromNumber,
        toNumber,
        direction,
        status,
        startTime,
        endTime,
        durationSeconds,
        billedMinutes,
        costType,
        sourceCallId,
    });

    // The test agent's calls are logged like any other (so the dial pad's
    // history still fills up) but never metered - its pool must not run dry
    // mid-test, and there's no customer plan funding these minutes.
    if (billedMinutes > 0 && !isTestAgent(agent)) {
        // Atomic $inc, not a read-modify-write on the in-memory `agent`
        // document - two calls ending for the same agent at once must not
        // let one deduction silently overwrite the other.
        await Agent.updateOne({ _id: agent._id }, { $inc: { minutesUsed: billedMinutes } });
        agent.minutesUsed += billedMinutes;
    }

    // Retention trim, deliberately last and swallowed: housekeeping must never
    // be able to lose the record we just wrote or undo the deduction above.
    // See utils/callHistory.js for why it batches instead of trimming per call.
    try {
        const pruned = await pruneAgentCallHistory(agent._id);
        if (pruned) {
            console.log(`call history: trimmed ${pruned} old rows for agent ${agent._id}`);
        }
    } catch (error) {
        console.error("Call history trim failed:", error.message);
    }

    return callRecord;
};