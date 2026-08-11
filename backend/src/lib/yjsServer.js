const { WebSocketServer } = require('ws');
const Y = require('yjs');
const syncProtocol = require('y-protocols/sync');
const awarenessProtocol = require('y-protocols/awareness');
const encoding = require('lib0/encoding');
const decoding = require('lib0/decoding');
const { parse: parseUrl } = require('url');
const { yDocToProsemirrorJSON, prosemirrorJSONToYDoc } = require('y-prosemirror');
// You need the same ProseMirror schema your editor/client uses to build contentJSON.
// Point this at wherever that schema is defined/exported in your project.
const { schema } = require('../prosemirror/schema');
const Document = require('../models/Document');
const { consumeTicket } = require('./wsTicketStore');

const messageSync = 0;
const messageAwareness = 1;

const YJS_FIELD_NAME = 'default';

const PERSIST_DEBOUNCE_MS = 3000;
const HEARTBEAT_INTERVAL_MS = 15000; // must be well under y-websocket client's
// default 30s "no message received" watchdog — native ws ping/pong frames are
// invisible to browser JS and won't satisfy that check on their own, so this
// also resends syncStep1 as a real protocol message the client's onmessage
// handler will see and use to refresh its own timer.

function startHeartbeat(wss) {
    const interval = setInterval(() => {
        wss.clients.forEach((ws) => {
            if (ws.isAlive === false) {
                console.log('[yjsServer] terminating dead connection (missed pong)');
                return ws.terminate();
            }
            ws.isAlive = false;
            ws.ping();

            const room = ws.__room;
            if (room && ws.readyState === ws.OPEN) {
                const encoder = encoding.createEncoder();
                encoding.writeVarUint(encoder, messageSync);
                syncProtocol.writeSyncStep1(encoder, room.ydoc);
                ws.send(encoding.toUint8Array(encoder));
            }
        });
    }, HEARTBEAT_INTERVAL_MS);

    wss.on('close', () => clearInterval(interval));
    return interval;
}
async function persistRoom(documentId, room) {
    console.log('[yjsServer] persistRoom starting for', documentId);
    try {
        const update = Y.encodeStateAsUpdate(room.ydoc);
        const contentJSON = yDocToProsemirrorJSON(room.ydoc, YJS_FIELD_NAME);
        console.log('[yjsServer] about to write to Mongo, contentJSON:', JSON.stringify(contentJSON));

        const result = await Document.findByIdAndUpdate(documentId, {
            yjsState: Buffer.from(update),
            contentJSON,
        });
        console.log('[yjsServer] Mongo write result — matched doc:', !!result);
    } catch (err) {
        console.error(`[yjsServer] Failed to persist document ${documentId}:`, err.stack || err);
    }
}

const SOLO_PERSIST_DEBOUNCE_MS = 300;

function schedulePersist(documentId, room, delayMs = PERSIST_DEBOUNCE_MS) {
    if (room.persistTimer) clearTimeout(room.persistTimer);
    room.persistTimer = setTimeout(() => {
        room.persistTimer = null;
        persistRoom(documentId, room).catch((err) =>
            console.error(`[yjsServer] persistRoom rejected for ${documentId}:`, err),
        );
    }, delayMs);
}

const rooms = new Map(); // documentId -> ready Room object
const roomCreationLocks = new Map(); // documentId -> in-flight creation Promise

async function getOrCreateRoom(documentId) {
    const existingRoom = rooms.get(documentId);
    if (existingRoom) return existingRoom;

    const existingLock = roomCreationLocks.get(documentId);
    if (existingLock) return existingLock;

    const creationPromise = (async () => {
        const ydoc = new Y.Doc();
        const awareness = new awarenessProtocol.Awareness(ydoc);
        awareness.setLocalState(null);

        const room = { ydoc, awareness, conns: new Set(), persistTimer: null };

        const existing = await Document.findById(documentId).select('+yjsState +contentJSON').lean();
        console.log('[yjsServer] hydrate check — existing found:', !!existing, 'yjsState present:', !!(existing && existing.yjsState));

        if (existing && existing.yjsState) {
            try {
                const stateBytes = Buffer.isBuffer(existing.yjsState)
                    ? existing.yjsState
                    : existing.yjsState.buffer;
                Y.applyUpdate(ydoc, stateBytes, 'hydrate');
            } catch (err) {
                console.error(`[yjsServer] CORRUPTED yjsState for document ${documentId}, starting empty:`, err.stack || err);
            }
        } else if (existing && existing.contentJSON) {
            try {
                console.log('[yjsServer] no yjsState found, seeding ydoc from contentJSON for', documentId);
                const seededDoc = prosemirrorJSONToYDoc(schema, existing.contentJSON, YJS_FIELD_NAME);
                const seedUpdate = Y.encodeStateAsUpdate(seededDoc);
                Y.applyUpdate(ydoc, seedUpdate, 'hydrate-from-json');
                seededDoc.destroy();

                schedulePersist(documentId, room, 0);
            } catch (err) {
                console.error(`[yjsServer] Failed to seed ydoc from contentJSON for document ${documentId}, starting empty:`, err.stack || err);
            }
        }

        ydoc.on('update', (update, origin) => {
            const encoder = encoding.createEncoder();
            encoding.writeVarUint(encoder, messageSync);
            syncProtocol.writeUpdate(encoder, update);
            const message = encoding.toUint8Array(encoder);

            room.conns.forEach((conn) => {
                if (conn !== origin && conn.readyState === conn.OPEN) {
                    conn.send(message);
                }
            });

            const delay = room.conns.size <= 1 ? SOLO_PERSIST_DEBOUNCE_MS : PERSIST_DEBOUNCE_MS;
            schedulePersist(documentId, room, delay);
        });

        rooms.set(documentId, room);
        roomCreationLocks.delete(documentId);
        return room;
    })();

    roomCreationLocks.set(documentId, creationPromise);
    return creationPromise;
}

function evictRoomIfEmpty(documentId, room) {
    if (room.conns.size > 0) return;
 
    if (room.persistTimer) {
        clearTimeout(room.persistTimer);
        room.persistTimer = null;
    }
 
    persistRoom(documentId, room)
        .catch((err) => console.error(`[yjsServer] Eviction persist failed for ${documentId}:`, err))
        .finally(() => {
            const current = rooms.get(documentId);
            if (current === room && room.conns.size === 0) {
                rooms.delete(documentId);
            }
        });
}
function initYjsServer(httpServer) {
    const wss = new WebSocketServer({ noServer: true });
    startHeartbeat(wss);
    httpServer.on('upgrade', (request, socket, head) => {
        const { pathname, query } = parseUrl(request.url, true);

        if (!pathname || !pathname.startsWith('/ws/')) {
            socket.destroy();
            return;
        }

        const documentId = pathname.slice('/ws/'.length);
        const ticket = typeof query.ticket === 'string' ? query.ticket : null;
        const entry = ticket ? consumeTicket(ticket) : null;

        wss.handleUpgrade(request, socket, head, (ws) => {
        if (!entry || entry.documentId !== documentId) {
                ws.close(4401, 'Invalid or expired ticket');
                return;
            }
            wss.emit('connection', ws, request, entry);
        });
    });

    wss.on('connection', async (ws, request, ticketEntry) => {
        try {
            console.log('[yjsServer] connection event fired', ticketEntry);
            const { documentId } = ticketEntry;

            const room = await getOrCreateRoom(documentId);
            console.log('[yjsServer] room ready, conns before add:', room.conns.size);

            room.conns.add(ws);
            ws.isAlive = true;
            ws.__room = room;
            ws.on('pong', () => { ws.isAlive = true; });
            console.log('[yjsServer] ws added to room, conns now:', room.conns.size);
            ws.controlledAwarenessIds = new Set();

            const awarenessChangeHandler = ({ added, updated, removed }, origin) => {
                if (origin !== ws) return;
                added.concat(updated).forEach((id) => ws.controlledAwarenessIds.add(id));
                removed.forEach((id) => ws.controlledAwarenessIds.delete(id));
            };
            room.awareness.on('update', awarenessChangeHandler);

            const syncEncoder = encoding.createEncoder();
            encoding.writeVarUint(syncEncoder, messageSync);
            syncProtocol.writeSyncStep1(syncEncoder, room.ydoc);
            console.log('[yjsServer] about to send syncStep1, readyState:', ws.readyState);
            ws.send(encoding.toUint8Array(syncEncoder));
            console.log('[yjsServer] syncStep1 sent');

            const awarenessStates = room.awareness.getStates();
            if (awarenessStates.size > 0) {
                const awarenessEncoder = encoding.createEncoder();
                encoding.writeVarUint(awarenessEncoder, messageAwareness);
                encoding.writeVarUint8Array(
                    awarenessEncoder,
                    awarenessProtocol.encodeAwarenessUpdate(room.awareness, Array.from(awarenessStates.keys())),
                );
                ws.send(encoding.toUint8Array(awarenessEncoder));
            }

            ws.on('message', (data) => {
                try {
                    console.log('[yjsServer] message received, byteLength:', data.length ?? data.byteLength);
                    const buf = new Uint8Array(data);
                    const decoder = decoding.createDecoder(buf);
                    const messageType = decoding.readVarUint(decoder);
                    console.log('[yjsServer] messageType:', messageType);

                    switch (messageType) {
                        case messageSync: {
                            const encoder = encoding.createEncoder();
                            encoding.writeVarUint(encoder, messageSync);
                            syncProtocol.readSyncMessage(decoder, encoder, room.ydoc, ws);
                            const replyLength = encoding.length(encoder);
                            console.log('[yjsServer] sync reply computed, length:', replyLength, '(>1 means content will be sent)');
                            if (replyLength > 1) {
                                ws.send(encoding.toUint8Array(encoder));
                                console.log('[yjsServer] sync reply SENT to client');
                            } else {
                                console.log('[yjsServer] no sync reply needed — server thinks client is already up to date');
                            }
                            break;
                        }
                        case messageAwareness: {
                            const update = decoding.readVarUint8Array(decoder);
                            awarenessProtocol.applyAwarenessUpdate(room.awareness, update, ws);
                            room.conns.forEach((conn) => {
                                if (conn !== ws && conn.readyState === conn.OPEN) {
                                    conn.send(data);
                                }
                            });
                            break;
                        }
                        default:
                            break;
                    }
                } catch (err) {
                    console.error(`[yjsServer] Error handling message for document ${documentId}:`, err.stack || err);
                }
            });

            ws.on('close', (code, reason) => {
                console.log('[yjsServer] ws closed, code:', code, 'reason:', reason?.toString());
                room.conns.delete(ws);
                room.awareness.off('update', awarenessChangeHandler);
                awarenessProtocol.removeAwarenessStates(room.awareness, Array.from(ws.controlledAwarenessIds), null);
                evictRoomIfEmpty(documentId, room);
            });

            ws.on('error', (err) => {
                console.error(`[yjsServer] Connection error for document ${documentId}:`, err.stack || err);
            });
        } catch (err) {
            console.error('[yjsServer] Error during connection setup:', err.stack || err);
            try {
                ws.close(1011, 'Internal error during setup');
            } catch (closeErr) {
                console.error('[yjsServer] Failed to close ws after setup error:', closeErr);
            }
        }
    });

    return wss;
}

module.exports = { initYjsServer };