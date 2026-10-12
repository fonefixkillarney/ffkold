/**
 * The bridge between Mongo and Asterisk's static endpoint list.
 *
 * Asterisk (without a realtime ODBC backend) can only learn about SIP
 * endpoints from files it parses at load time, so this app does not try to
 * create endpoints per agent. Instead a fixed pool of endpoints is generated
 * once - scripts/provisionSipPool.js writes pjsip_agents.conf AND these
 * documents from the same random passwords - and each agent is handed one slot
 * the first time they open the dial pad, keeping it from then on.
 *
 * Growing the pool is an ops step: re-run the generator with a bigger count,
 * copy the file to the PBX, `pjsip reload`. Nothing needs redeploying. If you
 * outgrow that (thousands of agents), the upgrade path is Asterisk realtime
 * with res_config_odbc against Postgres, at which point this module is the
 * only thing that has to change.
 */

import crypto from "crypto";
import SipCredential from "../../models/SipCredential.js";

/**
 * AES-256-GCM needs exactly 32 bytes; SHA-256 of whatever is in the env gives
 * us that from any passphrase length, so operators aren't forced to generate a
 * key of an exact size. Read per call, not at import: dotenv.config() runs
 * after this module's body (see utils/testAgent.js for the same note).
 */
const encryptionKey = () => {
    const secret = process.env.SIP_CREDENTIAL_SECRET;
    if (!secret) {
        throw new Error(
            "SIP_CREDENTIAL_SECRET is not set - WebRTC credentials cannot be encrypted or read"
        );
    }
    return crypto.createHash("sha256").update(secret).digest();
};

/** Packed as iv:authTag:ciphertext, all hex. */
export const encryptSecret = (plaintext) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return [iv.toString("hex"), cipher.getAuthTag().toString("hex"), ciphertext.toString("hex")].join(
        ":"
    );
};

export const decryptSecret = (packed) => {
    const [ivHex, tagHex, dataHex] = String(packed || "").split(":");
    if (!ivHex || !tagHex || !dataHex) {
        throw new Error("Stored SIP secret is malformed");
    }
    const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        encryptionKey(),
        Buffer.from(ivHex, "hex")
    );
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([
        decipher.update(Buffer.from(dataHex, "hex")),
        decipher.final(),
    ]).toString("utf8");
};

/**
 * base64url, so the value is safe to paste into pjsip.conf, into a SIP
 * Authorization header, and into a URL without any escaping.
 */
export const generateSipSecret = () => crypto.randomBytes(24).toString("base64url");

/**
 * The agent's existing slot, or a newly claimed free one.
 *
 * The claim is a single atomic findOneAndUpdate on `agentId: null` - two
 * browser tabs opening at once must not both be handed the same endpoint, or
 * the second registration would evict the first (max_contacts=1) and the agent
 * would silently stop receiving calls.
 *
 * @returns {{ username: string, secret: string }}
 */
export const assignSlotToAgent = async (agentId) => {
    const existing = await SipCredential.findOne({ agentId }).select("+secretEncrypted");
    const slot =
        existing ||
        (await SipCredential.findOneAndUpdate(
            { agentId: null },
            { $set: { agentId, assignedAt: new Date() } },
            { new: true }
        ).select("+secretEncrypted"));

    if (!slot) {
        throw new Error(
            "No free SIP endpoint in the pool - re-run scripts/provisionSipPool.js with a higher count and reload Asterisk"
        );
    }

    slot.lastIssuedAt = new Date();
    await slot.save();

    return { username: slot.username, secret: decryptSecret(slot.secretEncrypted) };
};

/** Frees the agent's slot for reuse (agent deleted, or manual ops cleanup). */
export const releaseSlotForAgent = async (agentId) =>
    SipCredential.updateOne({ agentId }, { $set: { agentId: null, assignedAt: null } });

/**
 * Endpoint name -> agent. This is how an inbound request from Asterisk
 * ("endpoint agent-007 wants to dial") is tied back to a real account, and it
 * is deliberately the ONLY direction of trust: Asterisk never tells us which
 * agent it thinks is calling.
 */
export const findAgentIdByEndpoint = async (username) => {
    const slot = await SipCredential.findOne({ username: String(username || "").trim() });
    return slot?.agentId ?? null;
};

/** Reverse lookup for inbound routing: which endpoint should ring for an agent. */
export const findEndpointForAgent = async (agentId) => {
    const slot = await SipCredential.findOne({ agentId });
    return slot?.username ?? null;
};
