/**
 * Server -> browser push for call events, over Server-Sent Events.
 *
 * Most of the dial pad's live state does NOT come through here: SIP.js already
 * knows the instant a call starts ringing, is answered, or hangs up, because
 * those are SIP responses arriving on its own WebSocket. Duplicating them
 * server-side would only add latency and a second source of truth.
 *
 * What this carries is the half the browser genuinely cannot know:
 *   - `call.recorded`  - Asterisk reported the finished call and the API has
 *                        written CallRecord and deducted minutes, so the
 *                        history list and remaining-minutes figure are stale.
 *   - `call.inbound`   - a PSTN call is on its way to this agent's endpoint,
 *                        with the caller already resolved to a contact/DID.
 *
 * SSE rather than WebSocket: one direction is all that's needed, it survives
 * the existing Nginx reverse proxy with one `proxy_buffering off`, it
 * reconnects on its own, and it adds no dependency to a codebase that has no
 * WebSocket server. The SIP WebSocket to Asterisk is the only socket the
 * browser needs to hold open, and that one Asterisk already provides.
 *
 * Scope limit worth knowing: subscribers live in THIS process's memory. Under
 * PM2 cluster mode an event published by the instance Asterisk happened to hit
 * would not reach an agent subscribed on another instance. Run the API as a
 * single instance (DEPLOYMENT.md does), or put Redis pub/sub behind
 * publishToAgent before scaling out.
 */

const subscribers = new Map();

const HEARTBEAT_MS = 25_000;
let heartbeat = null;

const write = (res, payload) => {
    try {
        res.write(payload);
    } catch {
        // Client vanished mid-write; the close handler will clean it up.
    }
};

const startHeartbeat = () => {
    if (heartbeat) return;
    // A comment line keeps idle connections alive through proxies that would
    // otherwise close them, and lets Express notice a dead socket.
    heartbeat = setInterval(() => {
        for (const connections of subscribers.values()) {
            for (const res of connections) write(res, ": ping\n\n");
        }
    }, HEARTBEAT_MS);
    // Never hold the event loop open on account of the heartbeat alone.
    heartbeat.unref?.();
};

const stopHeartbeatIfIdle = () => {
    if (heartbeat && subscribers.size === 0) {
        clearInterval(heartbeat);
        heartbeat = null;
    }
};

/**
 * Registers an open SSE response for an agent.
 * @returns {() => void} unsubscribe, safe to call more than once.
 */
export const subscribeAgent = (agentId, res) => {
    const key = String(agentId);
    if (!subscribers.has(key)) subscribers.set(key, new Set());
    subscribers.get(key).add(res);
    startHeartbeat();

    let done = false;
    return () => {
        if (done) return;
        done = true;
        const connections = subscribers.get(key);
        if (connections) {
            connections.delete(res);
            if (connections.size === 0) subscribers.delete(key);
        }
        stopHeartbeatIfIdle();
    };
};

/** Fan an event out to every tab this agent has open. No-op if none. */
export const publishToAgent = (agentId, event, data) => {
    const connections = subscribers.get(String(agentId));
    if (!connections?.size) return 0;

    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of connections) write(res, frame);
    return connections.size;
};

/** Diagnostics for the super-admin panel / health checks. */
export const connectedAgentCount = () => subscribers.size;
