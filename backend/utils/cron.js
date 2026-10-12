import cron from "node-cron";
import Admin from "../models/auth/admin.js";
import Agent from "../models/auth/agent.js";
import { monitorBalance } from "./telnyxMonitor.js";
import { activatePendingPlansIfFunded } from "./billing.js";

/**
 * Daily cycle-reset sweep: expires admin plans whose 30-day window has
 * passed, and zeroes out any agent whose cycle ended - unused minutes never
 * roll over. Exported directly so it can be invoked on demand (tests, a
 * manual "run now" trigger) without waiting for the cron schedule.
 */
export const runCycleResetJob = async () => {
    const now = new Date();

    const adminResult = await Admin.updateMany(
        { planStatus: "active", planEndDate: { $lt: now } },
        { $set: { planStatus: "expired" } }
    );

    // Pipeline update so $minuteAllocation is read per-document, not as a literal string.
    const agentResult = await Agent.updateMany(
        { cycleEnd: { $lt: now } },
        [{ $set: { minutesUsed: "$minuteAllocation" } }],
        { updatePipeline: true }
    );

    return {
        expiredAdmins: adminResult.modifiedCount,
        resetAgents: agentResult.modifiedCount,
    };
};

export const scheduleDailyCycleReset = () => {
    // Runs once a day at 00:05 server time.
    cron.schedule("5 0 * * *", () => {
        runCycleResetJob()
            .then(({ expiredAdmins, resetAgents }) => {
                console.log(
                    `Daily cycle reset: expired ${expiredAdmins} admin plan(s), zeroed ${resetAgents} agent(s)`
                );
            })
            .catch((error) => {
                console.error("Daily cycle reset job failed:", error);
            });
    });
};

/**
 * Samples the Super Admin's Telnyx balance, emails low-balance / fast-burn
 * alerts (cooldown-guarded), and auto-activates any plans that were held as
 * "pending_activation" once the balance is healthy again. Exported so it can
 * be triggered on demand.
 */
export const runTelnyxBalanceMonitor = async () => {
    const { status } = await monitorBalance();
    if (status) {
        const { activated } = await activatePendingPlansIfFunded(status);
        if (activated > 0) {
            console.log(`Telnyx funded again: activated ${activated} pending plan(s)`);
        }
    }
    return status;
};

export const scheduleTelnyxBalanceMonitor = () => {
    // Hourly, at minute 0. Frequent enough to catch a fast burn and to activate
    // pending plans soon after a top-up, without hammering the Telnyx API.
    cron.schedule("0 * * * *", () => {
        runTelnyxBalanceMonitor().catch((error) => {
            console.error("Telnyx balance monitor failed:", error);
        });
    });
};
