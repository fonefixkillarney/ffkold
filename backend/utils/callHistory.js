import CallRecord from "../models/CallRecord.js";

/**
 * Per-agent call-history retention.
 *
 * An agent only ever reads their most recent calls - listCalls in
 * controllers/callController.js hands back 100 and the dial pad shows no more
 * than that - so an agent who has been dialling for months is dragging around
 * thousands of rows nobody will ever open. This trims the tail off.
 *
 * High/low water rather than a flat cap: the history is allowed to grow to
 * HIGH_WATER and is then cut back to LOW_WATER in one delete, so the trim runs
 * once every 50 calls instead of on every single one. That is what makes it
 * cheap enough to sit inside the call-recording path.
 *
 * The cap covers BOTH directions. Trimming only the dialled rows would leave
 * inbound history growing without limit, and the list the agent actually reads
 * is one mixed feed - capping half of it would not bound anything. To make it
 * outbound-only, add `direction: "outbound"` to historyScope below.
 *
 * This is a hard delete of rows that carry billedMinutes, so anything that
 * must survive it (invoices, per-cycle usage reports) has to be derived from
 * the agent's minutesUsed counter or an aggregate written before the trim -
 * not by re-reading CallRecord.
 */
export const HISTORY_HIGH_WATER = 150;
export const HISTORY_LOW_WATER = 100;

const historyScope = (agentId) => ({ agentId });

/**
 * Cuts one agent's history back to LOW_WATER once it reaches HIGH_WATER.
 * Below the high-water mark this is a single indexed count and nothing else.
 *
 * @returns {Promise<number>} rows deleted (0 on every call that is under cap)
 */
export const pruneAgentCallHistory = async (agentId) => {
    const scope = historyScope(agentId);

    const total = await CallRecord.countDocuments(scope);
    if (total < HISTORY_HIGH_WATER) return 0;

    // Collect the ids to drop rather than deleting by a createdAt cutoff: two
    // rows can share a timestamp to the millisecond, and a cutoff would then
    // take both or neither, leaving the count off by one either way.
    const stale = await CallRecord.find(scope)
        .sort({ createdAt: 1, _id: 1 })
        .limit(total - HISTORY_LOW_WATER)
        .select("_id")
        .lean();

    if (!stale.length) return 0;

    // Two calls ending at once for the same agent can both pass the count
    // check. They select the same oldest ids, so the second delete is a no-op
    // rather than an over-trim.
    const { deletedCount } = await CallRecord.deleteMany({
        _id: { $in: stale.map((row) => row._id) },
    });
    return deletedCount;
};
