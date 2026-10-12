/**
 * Generates the WebRTC SIP endpoint pool.
 *
 *   npm run sip:pool             # 25 slots (default)
 *   npm run sip:pool -- 100      # 100 slots
 *
 * Asterisk learns about SIP endpoints from a file it parses at load time, and
 * the API has to know the same passwords in order to hand them to browsers. So
 * both are produced here in one pass from the same random secrets: the file goes
 * to the PBX, the encrypted copies go to Mongo.
 *
 * Output: asterisk/pjsip_agents.conf (relative to the repo root). Copy it to
 * /etc/asterisk/pjsip_agents.conf on the PBX and run `pjsip reload`.
 *
 * Safe to re-run. Existing slots keep their passwords - regenerating them would
 * knock every signed-in agent off the PBX the moment Asterisk reloaded - and
 * only the shortfall up to the requested count is created. The conf file is
 * always rewritten in full from what is in Mongo, so the two cannot drift.
 */

import dotenv from "dotenv";
dotenv.config();

import fs from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import connectDB from "../db/db.js";
import "../models/index.js";
import SipCredential from "../models/SipCredential.js";
import { encryptSecret, decryptSecret, generateSipSecret } from "../utils/telephony/sipPool.js";

const DEFAULT_COUNT = 25;
const OUTPUT_PATH = path.resolve(process.cwd(), "..", "asterisk", "pjsip_agents.conf");

const slotName = (index) => `agent-${String(index).padStart(3, "0")}`;

const renderConf = (slots) => {
    const header = `;=============================================================================
; GENERATED FILE - do not edit by hand.
;
; Produced by be-enterdial/scripts/provisionSipPool.js. Every endpoint below has
; a matching SipCredential document in MongoDB holding the same password
; (encrypted), which is what lets the API hand these credentials to a browser.
; Editing a password here without updating Mongo will simply stop that agent
; from registering.
;
; Endpoints: ${slots.length}
; Deploy: copy to /etc/asterisk/pjsip_agents.conf, then \`asterisk -rx "pjsip reload"\`
;=============================================================================
`;

    const blocks = slots.map(
        (slot) => `
[${slot.username}](webrtc-agent)
auth=${slot.username}-auth
aors=${slot.username}-aor

[${slot.username}-auth]
type=auth
auth_type=userpass
username=${slot.username}
password=${slot.secret}

[${slot.username}-aor](webrtc-aor)
`
    );

    return `${header}${blocks.join("")}`;
};

async function run() {
    const requested = Number.parseInt(process.argv[2], 10) || DEFAULT_COUNT;

    if (!process.env.SIP_CREDENTIAL_SECRET) {
        console.error(
            "SIP_CREDENTIAL_SECRET is not set in .env - generate one first:\n" +
                '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
        );
        process.exit(1);
    }

    await connectDB();

    const existingCount = await SipCredential.countDocuments({});
    const toCreate = Math.max(0, requested - existingCount);

    for (let index = existingCount + 1; index <= existingCount + toCreate; index += 1) {
        const username = slotName(index);
        // Upsert rather than create: a half-finished earlier run may already
        // have left this name behind, and a duplicate-key crash mid-loop would
        // leave the conf file and Mongo out of step.
        await SipCredential.updateOne(
            { username },
            { $setOnInsert: { username, secretEncrypted: encryptSecret(generateSipSecret()) } },
            { upsert: true }
        );
    }

    const slots = await SipCredential.find({}).select("+secretEncrypted").sort({ username: 1 });
    const rendered = renderConf(
        slots.map((slot) => ({ username: slot.username, secret: decryptSecret(slot.secretEncrypted) }))
    );

    await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
    await fs.writeFile(OUTPUT_PATH, rendered, { mode: 0o640 });

    const assigned = await SipCredential.countDocuments({ agentId: { $ne: null } });

    console.log(`SIP pool: ${slots.length} endpoints (${toCreate} new, ${assigned} assigned to agents)`);
    console.log(`Wrote ${OUTPUT_PATH}`);
    console.log("\nNext:");
    console.log("  scp asterisk/pjsip_agents.conf pbx:/etc/asterisk/pjsip_agents.conf");
    console.log('  ssh pbx \'asterisk -rx "pjsip reload"\'');

    await mongoose.connection.close();
    process.exit(0);
}

run().catch(async (error) => {
    console.error("SIP pool provisioning failed:", error);
    await mongoose.connection.close().catch(() => {});
    process.exit(1);
});
