/**
 * Is the Asterisk PBX wired up as the source of truth for call completion?
 *
 * Two other code paths can also write a CallRecord - the Telnyx webhook and the
 * legacy client-reported /calls/complete endpoint. With Asterisk in the picture
 * all three would fire for the same conversation and the agent would be billed
 * two or three times over, so those two stand down when this returns true.
 *
 * ASTERISK_SHARED_SECRET is the signal because it is exactly what the dialplan
 * needs in order to report anything: if it is set, the PBX can reach
 * /api/telephony/asterisk/call-ended, and that report is the most accurate one
 * available (Asterisk sees both call legs and holds the real answer timer).
 */
export const isAsteriskCallReportingEnabled = () =>
    Boolean(process.env.ASTERISK_SHARED_SECRET);
