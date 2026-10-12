/**
 * Test-mode escape hatch, for verifying real call quality without a funded
 * plan sitting behind the agent.
 *
 * The one agent whose email matches TEST_AGENT_EMAIL gets:
 *   - a one-step login: the emailed 6-digit code, the assigned-number match,
 *     and the email-verified requirement are all skipped (the password is
 *     still checked - see controllers/agentAuthController.js),
 *   - unlimited dialing: no plan-expiry, plan-pending, or minutes-remaining
 *     gate applies (checkCanDial in utils/billing.js),
 *   - no per-agent metering: completed calls are still written to CallRecord
 *     for the history list, but nothing is deducted from the agent's minute
 *     pool (recordBilledCall in utils/billing.js). The carrier cost lands on
 *     the Super Admin's Telnyx account instead, which is the point of the mode,
 *   - no dial rate limit (middleware/rateLimiter.js -> dialLimiter).
 *
 * BOTH TEST_AGENT_EMAIL and TEST_AGENT_UNLIMITED=true are required, so a
 * leftover email on its own can never silently un-gate a real agent. Clearing
 * either one puts that account straight back on the normal rules with no other
 * code change. Nothing here should ever be enabled on a production deployment.
 *
 * env is read per call rather than cached at import time: server.js calls
 * dotenv.config() in its module body, which runs AFTER every module it imports
 * has already been evaluated.
 */

const testAgentEmail = () => (process.env.TEST_AGENT_EMAIL || "").trim().toLowerCase();

export const isTestAgentModeEnabled = () =>
    Boolean(testAgentEmail()) && process.env.TEST_AGENT_UNLIMITED === "true";

export const isTestAgentEmail = (email) =>
    isTestAgentModeEnabled() &&
    String(email || "")
        .trim()
        .toLowerCase() === testAgentEmail();

export const isTestAgent = (agent) => isTestAgentEmail(agent?.email);
