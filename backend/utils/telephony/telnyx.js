// Telnyx is the telephony carrier, used as an Elastic SIP Trunk behind
// Asterisk. This module isolates every Telnyx API call behind the same
// stable interface the app used with the previous carrier
// (listAvailableNumbers, purchaseNumber, initiateCall, handleCallEvent) so
// nothing outside this file needs to know provider details.
//
// Split of responsibilities with Telnyx Elastic SIP Trunking:
//   - Number search/purchase/inventory: Telnyx REST API v2 (this file).
//   - Placing and bridging calls: Asterisk on the Hetzner VPS, which is
//     registered against the Telnyx trunk (see docs/telnyx-setup.md). Elastic
//     SIP Trunking deliberately has no REST "place a call" endpoint - the
//     PSTN leg is a SIP INVITE from Asterisk, unlike the previous carrier's
//     LaML Calls.json API. initiateCall below therefore only records the
//     attempt; it never dials.
//   - Call status webhooks: controllers/telephonyController.js, verified
//     with verifyTelnyxSignature below.

import crypto from "crypto";
import PhoneNumber from "../../models/PhoneNumber.js";
import Voicemail from "../../models/Voicemail.js";
import Agent from "../../models/auth/agent.js";
import Admin from "../../models/auth/admin.js";
import { recordBilledCall } from "../billing.js";
import { isTelnyxConfigured, getTelnyxClient as getClient } from "./telnyxClient.js";

// Re-exported for backward compatibility - the client + balance read now live
// in telnyxClient.js (see that file for why: import-cycle avoidance).
export { isTelnyxConfigured, getTelnyxBalance } from "./telnyxClient.js";

// Telnyx's API uses ISO 3166-1 alpha-2 country codes - the UK's code is
// "GB", not "UK" (our own PhoneNumber.region keeps "UK" since that's the
// business-facing term used throughout this app).
const REGION_TO_ISO_COUNTRY = { UK: "GB", IE: "IE", US: "US", CA: "CA" };
const ISO_COUNTRY_TO_REGION = Object.fromEntries(
    Object.entries(REGION_TO_ISO_COUNTRY).map(([region, iso]) => [iso, region])
);

// Fallback when a Telnyx phone-number record doesn't carry its country:
// dialing-prefix -> region. +1 is shared by US and Canada, so US is only a
// best guess there - country_iso_alpha2 from the API wins whenever present.
const PREFIX_TO_REGION = [
    { prefix: "+44", region: "UK" },
    { prefix: "+353", region: "IE" },
    { prefix: "+1", region: "US" },
];

const regionForTelnyxNumber = (entry) => {
    const iso = entry.country_iso_alpha2 || entry.country_code;
    if (iso && ISO_COUNTRY_TO_REGION[iso]) return ISO_COUNTRY_TO_REGION[iso];
    const match = PREFIX_TO_REGION.find(({ prefix }) =>
        String(entry.phone_number || "").startsWith(prefix)
    );
    return match ? match.region : null;
};

/**
 * Numbers available to purchase are served from our own PhoneNumber
 * collection (status: "available", adminId: null), refreshed from Telnyx's
 * real inventory just before every read (see syncAvailableNumbersFromTelnyx
 * below). Falls back to whatever is already in the collection if Telnyx
 * isn't configured, or if the live sync call fails.
 */
export const listAvailableNumbers = async (region) => {
    if (isTelnyxConfigured()) {
        const [availableResult, ownedResult] = await Promise.allSettled([
            syncAvailableNumbersFromTelnyx(region),
            syncOwnedNumbersFromTelnyx(),
        ]);
        if (availableResult.status === "rejected") {
            console.error(
                "Failed to sync available numbers from Telnyx:",
                availableResult.reason?.response?.data || availableResult.reason?.message
            );
        }
        if (ownedResult.status === "rejected") {
            console.error(
                "Failed to sync owned numbers from Telnyx:",
                ownedResult.reason?.response?.data || ownedResult.reason?.message
            );
        }
    }

    return PhoneNumber.find({ region, status: "available" }).sort({ number: 1 });
};

/**
 * Pulls real availability from Telnyx's available_phone_numbers API and
 * upserts into our PhoneNumber collection. Called from listAvailableNumbers
 * above on every "get available numbers" request once TELNYX_API_KEY is set,
 * so listings stay live. Uses one bulk upsert instead of a per-number
 * find+create loop (the loop was the original "available numbers loads
 * slowly" complaint - up to 20 sequential round trips to Mongo per request).
 */
export const syncAvailableNumbersFromTelnyx = async (region, { limit = 20 } = {}) => {
    const isoCountry = REGION_TO_ISO_COUNTRY[region];
    if (!isoCountry) throw new Error(`Unsupported region: ${region}`);

    const { data } = await getClient().get("/available_phone_numbers", {
        params: {
            "filter[country_code]": isoCountry,
            "filter[features][]": "voice",
            "filter[limit]": limit,
        },
    });

    const numbers = data?.data || [];
    if (numbers.length === 0) return 0;

    const result = await PhoneNumber.bulkWrite(
        numbers.map((entry) => ({
            updateOne: {
                filter: { number: entry.phone_number },
                update: {
                    $setOnInsert: {
                        number: entry.phone_number,
                        region,
                        provider: "telnyx",
                        telnyxId: null,
                        status: "available",
                    },
                },
                upsert: true,
            },
        })),
        { ordered: false }
    );
    return result.upsertedCount;
};

/**
 * Numbers bought directly through Telnyx's own portal (bypassing this app's
 * Buy Number flow) never get a PhoneNumber document, so they'd be invisible
 * on both the "available" and "your numbers" tabs. This pulls Telnyx's real
 * phone_numbers list (numbers our account already owns) and creates a local
 * record for any number we don't already track. Telnyx has no concept of our
 * adminId, so there's no way to know which admin a manually-purchased number
 * should belong to - new records go in as "available" so any admin can claim
 * it through the normal Buy Number flow. $setOnInsert leaves numbers we
 * already track (available or assigned) completely untouched.
 */
export const syncOwnedNumbersFromTelnyx = async () => {
    const { data } = await getClient().get("/phone_numbers", {
        params: { "page[size]": 250 },
    });

    const numbers = data?.data || [];
    if (numbers.length === 0) return 0;

    const ops = numbers
        .map((entry) => {
            const region = regionForTelnyxNumber(entry);
            if (!region) return null;
            return {
                updateOne: {
                    filter: { number: entry.phone_number },
                    update: {
                        $setOnInsert: {
                            number: entry.phone_number,
                            region,
                            provider: "telnyx",
                            telnyxId: entry.id || null,
                            status: "available",
                        },
                    },
                    upsert: true,
                },
            };
        })
        .filter(Boolean);

    if (ops.length === 0) return 0;

    const result = await PhoneNumber.bulkWrite(ops, { ordered: false });
    return result.upsertedCount;
};

export const purchaseNumber = async (numberId, adminId) => {
    // Atomic find-and-update so two admins racing to buy the same number
    // can't both succeed - the status:"available" filter is re-checked by
    // MongoDB at write time, not just at an earlier read.
    const phoneNumber = await PhoneNumber.findOneAndUpdate(
        { _id: numberId, status: "available" },
        { $set: { status: "assigned", adminId } },
        { new: true }
    );

    if (!phoneNumber) {
        throw new Error("Number not found or no longer available");
    }

    if (isTelnyxConfigured()) {
        try {
            // connection_id attaches the purchased number to our Elastic SIP
            // Trunking connection, so inbound calls to it route straight to
            // Asterisk without a manual portal step.
            const order = {
                phone_numbers: [{ phone_number: phoneNumber.number }],
            };
            if (process.env.TELNYX_CONNECTION_ID) {
                order.connection_id = process.env.TELNYX_CONNECTION_ID;
            }
            const { data } = await getClient().post("/number_orders", order);
            // Number orders are asynchronous on Telnyx's side ("pending" ->
            // "success"), but a 2xx here means the order was accepted and the
            // number is reserved for us, which is what "purchased" means to
            // this app. The per-number id is what later API calls key on.
            phoneNumber.telnyxId =
                data?.data?.phone_numbers?.[0]?.id || data?.data?.id || phoneNumber.telnyxId;
            await phoneNumber.save();
        } catch (error) {
            // Telnyx never actually accepted the order - the reservation
            // above must not strand the number as "ours".
            await PhoneNumber.findByIdAndUpdate(phoneNumber._id, {
                $set: { status: "available", adminId: null },
            });
            console.error(
                "Telnyx number purchase failed, reservation rolled back:",
                error?.response?.data || error.message
            );
            throw new Error("Could not purchase this number, please try again");
        }
    } else {
        console.warn(
            "TELNYX_API_KEY not set - purchaseNumber recorded the number locally without calling Telnyx's API"
        );
    }

    await Admin.findByIdAndUpdate(adminId, { $addToSet: { numbersOwned: phoneNumber._id } });

    return phoneNumber;
};

/**
 * Records the outbound call attempt for the dial pad's call-logging flow.
 *
 * With Elastic SIP Trunking the PSTN leg is NOT placed from here: Asterisk
 * originates the SIP INVITE over the Telnyx trunk (App -> Asterisk -> Telnyx
 * -> PSTN), so there is no carrier REST call to make - Telnyx's REST dialing
 * lives in its separate Voice API / Call Control product, which we
 * deliberately don't use since Asterisk owns all call logic. The previous
 * carrier's Calls.json + LaML flow (and its ENABLE_LIVE_CALLS gate) is gone
 * for the same reason.
 *
 * Billing stays server-authoritative via the Telnyx webhook
 * (controllers/telephonyController.js -> handleCallEvent), with
 * callController.js's client-reported completeCall as the fallback.
 */
export const initiateCall = async ({ from, to, agentId }) => {
    return {
        providerCallId: `local_call_${Date.now()}`,
        from,
        to,
        agentId,
        status: "initiated",
    };
};

/**
 * Telnyx webhook signature: Ed25519 over `${telnyx-timestamp}|${raw body}`,
 * base64-encoded in the `telnyx-signature-ed25519` header. TELNYX_PUBLIC_KEY
 * is the base64 raw 32-byte public key shown in the Telnyx portal (Account
 * Settings -> Keys & Credentials -> Public Key); it gets wrapped in the DER
 * SPKI prefix so Node's crypto can consume it. Only enforced when
 * TELNYX_PUBLIC_KEY is set - left optional so a mismatch can't silently
 * block every real call event by default.
 */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const WEBHOOK_TOLERANCE_SECONDS = 300;

export const verifyTelnyxSignature = (rawBody, signatureHeader, timestampHeader) => {
    const publicKey = process.env.TELNYX_PUBLIC_KEY;
    if (!publicKey) return true;
    if (!signatureHeader || !timestampHeader) return false;

    const timestamp = Number.parseInt(timestampHeader, 10);
    if (
        !Number.isFinite(timestamp) ||
        Math.abs(Date.now() / 1000 - timestamp) > WEBHOOK_TOLERANCE_SECONDS
    ) {
        return false;
    }

    try {
        const rawKey = Buffer.from(publicKey, "base64");
        if (rawKey.length !== 32) return false;
        const key = crypto.createPublicKey({
            key: Buffer.concat([ED25519_SPKI_PREFIX, rawKey]),
            format: "der",
            type: "spki",
        });
        const message = Buffer.concat([
            Buffer.from(`${timestampHeader}|`, "utf8"),
            Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || "", "utf8"),
        ]);
        return crypto.verify(null, message, key, Buffer.from(signatureHeader, "base64"));
    } catch (error) {
        console.error("Telnyx signature verification errored:", error.message);
        return false;
    }
};

/**
 * Called by controllers/telephonyController.js once Telnyx (or the
 * client-reported fallback in callController.js) reports how a call ended.
 * Carrier-agnostic: everything here operates on our own models.
 */
export const handleCallEvent = async (event) => {
    const { agentId, fromNumber, toNumber, direction, status, startTime, endTime, costType, audioUrl } =
        event;

    const agent = await Agent.findById(agentId);
    if (!agent) {
        throw new Error("Unknown agent for call event");
    }
    const admin = await Admin.findById(agent.adminId);

    if (status === "voicemail") {
        return Voicemail.create({
            agentId: agent._id,
            adminId: admin._id,
            fromNumber,
            audioUrl,
            durationSeconds:
                endTime && startTime ? Math.max(0, Math.round((endTime - startTime) / 1000)) : 0,
        });
    }

    return recordBilledCall({
        agent,
        admin,
        fromNumber,
        toNumber,
        direction,
        status,
        startTime: new Date(startTime),
        endTime: endTime ? new Date(endTime) : null,
        costType,
    });
};
