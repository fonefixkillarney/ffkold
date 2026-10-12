/**
 * Self-provisioning for the test agent.
 *
 * The bypass in controllers/agentAuthController.js only ever ran for an agent
 * that ALREADY existed in Mongo - it sits after the findOne/password check, so
 * on a fresh deployment (no admin, no plan, no agent) it was unreachable and
 * every attempt fell out at the 401. That defeated the whole point of a test
 * account: proving the calling path works without first buying a plan.
 *
 * This module creates the minimum chain the Agent schema requires - Admin ->
 * PhoneNumber -> Agent - on the first login attempt, so the test agent needs
 * nothing set up by hand.
 *
 * It is gated FIVE ways. All must hold:
 *   1. TEST_AGENT_EMAIL is set
 *   2. TEST_AGENT_UNLIMITED=true          (1+2 = isTestAgentModeEnabled)
 *   3. TEST_AGENT_PASSWORD is set, >= 8 chars
 *   4. TEST_AGENT_NUMBER is set
 *   5. the submitted email AND password match those exactly
 *
 * This is a deliberate backdoor. Clear TEST_AGENT_* in production - any one of
 * them being empty disables it completely.
 */

import crypto from "crypto";
import Admin from "../models/auth/admin.js";
import Agent from "../models/auth/agent.js";
import PhoneNumber from "../models/PhoneNumber.js";
import { hashPassword } from "./password.js";
import { getActivePlans, getPlanByKey } from "./planConfig.js";
import { isTestAgentModeEnabled } from "./testAgent.js";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 8;

const env = (key) => (process.env[key] || "").trim();

export const getTestAgentPassword = () => env("TEST_AGENT_PASSWORD");
export const getTestAgentNumber = () => env("TEST_AGENT_NUMBER");

/** The admin that owns the test agent. Kept separate from any real account. */
const testAdminEmail = () =>
    env("TEST_AGENT_ADMIN_EMAIL").toLowerCase() || "test-admin@enterdial.local";

/**
 * True when the deployment is configured to mint the test agent on demand.
 * Deliberately strict: a half-configured backdoor is worse than none.
 */
export const canSelfProvisionTestAgent = () =>
    isTestAgentModeEnabled() &&
    getTestAgentPassword().length >= MIN_PASSWORD_LENGTH &&
    Boolean(getTestAgentNumber());

/** PhoneNumber.region is an enum, so a number has to map onto one of the four. */
const regionForNumber = (number) => {
    if (number.startsWith("+44")) return "UK";
    if (number.startsWith("+353")) return "IE";
    if (number.startsWith("+1")) return "US";
    return "UK";
};

/** The plan whose minutes the test agent is given. Cosmetic - it dials unmetered. */
const testPlan = () => getPlanByKey("single") || getActivePlans()[0] || null;

/**
 * Creates (or reuses) the Admin -> PhoneNumber -> Agent chain for the test
 * account and returns the Agent with `passwordHash` selected and
 * `assignedNumber` populated, exactly as the login controller's own query
 * would have produced.
 *
 * Idempotent: every step is find-or-create, so repeated logins reuse the same
 * documents rather than piling up duplicates.
 */
export const provisionTestAgent = async (email) => {
    const now = new Date();
    const plan = testPlan();
    const number = getTestAgentNumber();

    console.warn(
        `⚠️  TEST AGENT: provisioning "${email}" on demand. This bypasses payment ` +
        "and the emailed login code. Clear TEST_AGENT_* to disable."
    );

    // --- Admin -----------------------------------------------------------
    // The schema's pre-validate hook demands a password or a Google link, so
    // a random unusable hash goes on: nobody is meant to sign in as this one.
    let admin = await Admin.findOne({ email: testAdminEmail() });
    if (!admin) {
        admin = await Admin.create({
            name: "Test Admin",
            email: testAdminEmail(),
            passwordHash: await hashPassword(crypto.randomBytes(24).toString("hex")),
            companyName: "Test Account",
            isEmailVerified: true,
            emailNotificationsEnabled: false,
        });
    }

    // Keep the plan window open so anything that reads it (the panel, the
    // cycle-reset sweep) sees a coherent account rather than an expired one.
    if (admin.planStatus !== "active" || !admin.planEndDate || admin.planEndDate < now) {
        admin.planKey = plan?.key ?? "single";
        admin.planStatus = "active";
        admin.planStartDate = now;
        admin.planEndDate = new Date(now.getTime() + THIRTY_DAYS_MS);
        admin.agentLimit = Math.max(1, admin.agentLimit || 1);
        admin.minutesPerAgent = plan?.minutesPerUser ?? 1200;
        await admin.save();
    }

    // --- PhoneNumber -----------------------------------------------------
    // For a call to actually reach the PSTN this must be a number the Telnyx
    // account really owns; anything else only exercises the UI.
    let phoneNumber = await PhoneNumber.findOne({ number });
    if (!phoneNumber) {
        phoneNumber = await PhoneNumber.create({
            number,
            region: regionForNumber(number),
            provider: "telnyx",
            status: "assigned",
            adminId: admin._id,
        });
    } else if (!phoneNumber.adminId) {
        phoneNumber.adminId = admin._id;
        phoneNumber.status = "assigned";
        await phoneNumber.save();
    }

    // --- Agent -----------------------------------------------------------
    let agent = await Agent.findOne({ email });
    if (!agent) {
        agent = await Agent.create({
            name: "Test Agent",
            email,
            passwordHash: await hashPassword(getTestAgentPassword()),
            adminId: admin._id,
            assignedNumber: phoneNumber._id,
            minuteAllocation: plan?.minutesPerUser ?? 1200,
            minutesUsed: 0,
            cycleStart: admin.planStartDate ?? now,
            cycleEnd: admin.planEndDate ?? new Date(now.getTime() + THIRTY_DAYS_MS),
            status: "active",
            isEmailVerified: true,
        });
    }

    if (!phoneNumber.assignedAgentId) {
        phoneNumber.assignedAgentId = agent._id;
        await phoneNumber.save();
    }

    // Re-read through the same shape the caller expects.
    return Agent.findById(agent._id).select("+passwordHash").populate("assignedNumber");
};
