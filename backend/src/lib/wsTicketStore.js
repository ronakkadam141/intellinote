const crypto = require('crypto');

/**
 * single use short lived tickets for authenticating websocket connections 
    
    Why this exists: the browser's native WebSocket API cannot send custom
    headers, so the normal `Authorization: Bearer <jwt>` pattern used on every
    REST call doesn't work for the WS handshake. Instead, the client first
    calls a normal authenticated REST endpoint (which CAN use the header like
    everything else) to get a ticket, then connects to the WS with that
    ticket in the query string. The ticket is useless after one redemption
    and expires quickly, so it's safe to have briefly sit in a URL/log —
    unlike the real JWT, which is long-lived.

    In-memory Map is sufficient at this scale (single Node process). If this
    ever needs to run across multiple backend instances, this would need to
    move to Redis — not needed for the current MVP.
 */

const TICKET_TTL_MS = 30*1000;

const tickets = new Map();

function createTicket({userId,workspaceId,documentId,role}){
    const ticket = crypto.randomBytes(24).toString('hex');

    tickets.set(ticket,{
        userId,
        workspaceId,
        documentId,
        role,
        expiresAt:Date.now()+TICKET_TTL_MS,
    });

    return ticket;
}

function consumeTicket(ticket){
    const entry = tickets.get(ticket);
    if(!entry) return null;

    tickets.delete(ticket);

    if(Date.now()>entry.expiresAt) return null;

    return entry;
}

setInterval(()=>{
    const now = Date.now();

    for(const [ticket,entry] of tickets){
        if(now > entry.expiresAt) tickets.delete(ticket);
    }
},60*1000).unref();

module.exports = {createTicket,consumeTicket};