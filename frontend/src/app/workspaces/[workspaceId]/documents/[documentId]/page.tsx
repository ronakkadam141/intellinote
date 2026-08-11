"use client";

import { useEffect, useRef, useState, useCallback, ChangeEvent } from "react";
import { useParams } from "next/navigation";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import RequireAuth from "@/components/RequireAuth";
import { apiClient, ApiError } from "@/lib/apiClient";

interface DocumentDetail {
    id: string;
    title: string;
    workspaceId: string;
    folderId: string | null;
}

const YJS_FIELD_NAME = "default";
const TITLE_AUTOSAVE_DELAY_MS = 1500;
const SYNC_TIMEOUT_MS = 2500;
const MAX_CONNECT_ATTEMPTS = 4;

type TitleStatus = "idle" | "saving" | "saved" | "error";
type ConnectionStatus = "connecting" | "connected" | "disconnected";

function DocumentEditorContent() {
    const { workspaceId, documentId } = useParams<{ workspaceId: string; documentId: string }>();

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [folderId, setFolderId] = useState<string | null>(null);

    const [title, setTitle] = useState("");
    const [titleStatus, setTitleStatus] = useState<TitleStatus>("idle");
    const titleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");

    const providerRef = useRef<WebsocketProvider | null>(null);

    const [ydoc] = useState(() => new Y.Doc());

    useEffect(() => {
        const logUpdate = (update: Uint8Array, origin: unknown) => {
            console.log('[DEBUG] ydoc update — byteLength:', update.length, 'origin:', origin, 'ydoc content now:', ydoc.getXmlFragment(YJS_FIELD_NAME).toString());
        };
        ydoc.on('update', logUpdate);
        return () => { ydoc.off('update', logUpdate); };
    }, [ydoc]);

    const editor = useEditor({
        immediatelyRender: false,
        extensions: [
            StarterKit.configure({ undoRedo: false }),
            Collaboration.configure({ document: ydoc, field: YJS_FIELD_NAME }),
        ],
        editorProps: {
            attributes: {
                class: "border rounded p-4 min-h-[300px] focus:outline-none",
            },
        },
    });

    useEffect(() => {
        if (editor) {
            console.log('[DEBUG] editor ready, current text:', editor.getText());
        }
    }, [editor]);

    useEffect(() => {
        let cancelled = false;

        apiClient
            .get<{ document: DocumentDetail }>(`/api/workspaces/${workspaceId}/documents/${documentId}`)
            .then(({ document }) => {
                if (cancelled) return;
                setTitle(document.title);
                setFolderId(document.folderId);
            })
            .catch((err) => {
                if (!cancelled) {
                    setError(err instanceof ApiError ? err.message : "Failed to load document.");
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [workspaceId, documentId]);

    // Fetch a ws-ticket, then connect the Yjs WebSocket provider to the
    // already-existing ydoc. If sync doesn't complete within SYNC_TIMEOUT_MS,
    // the connection is presumed stuck (a known race in the underlying
    // library when a fresh connection follows a very recent one for the
    // same document) — kill it and retry with a brand new ticket rather
    // than leaving the user staring at a blank editor.
    useEffect(() => {
        let cancelled = false;
        let provider: WebsocketProvider | null = null;
        let syncTimeout: ReturnType<typeof setTimeout> | null = null;

        async function connect() {
            try {
                const retryKey = `yjs-sync-retry:${documentId}`;
                const retryAttempts = Number(sessionStorage.getItem(retryKey) ?? "0");
                if (retryAttempts >= MAX_CONNECT_ATTEMPTS) {
                    sessionStorage.removeItem(retryKey);
                    setError("Couldn't establish a live session after several attempts. Please refresh manually.");
                    setConnectionStatus("disconnected");
                    return;
                }

                const { ticket } = await apiClient.post<{ ticket: string }>(
                    `/api/workspaces/${workspaceId}/documents/${documentId}/ws-ticket`,
                );
                if (cancelled) return;

                const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "";
                const wsBase = apiUrl.replace(/^http/, "ws");

                const p = new WebsocketProvider(`${wsBase}/ws`, documentId, ydoc, {
                    params: { ticket },
                    connect: true,
                    resyncInterval: -1,
                    shouldReconnect: () => false,
                });

                if (cancelled) {
                    p.destroy();
                    return;
                }

                provider = p;
                providerRef.current = p;

                p.on("status", ({ status }: { status: ConnectionStatus }) => {
                    if (!cancelled) setConnectionStatus(status);
                });

                p.on("closed", () => {
                    if (!cancelled) setConnectionStatus("disconnected");
                });

                // A stuck handshake here means the client's Y.Doc state is
                // confused — retrying in-place with the same doc doesn't help,
                // it needs a completely fresh Y.Doc, which only a real reload
                // gives us. Capped via sessionStorage (survives the reload,
                // unlike any in-memory counter) so a genuinely broken
                // connection surfaces as an error instead of reloading forever.
                syncTimeout = setTimeout(() => {
                    if (cancelled) return;
                    const nextAttempts = retryAttempts + 1;
                    if (nextAttempts >= MAX_CONNECT_ATTEMPTS) {
                        sessionStorage.removeItem(retryKey);
                        setError("Couldn't establish a live session after several attempts. Please refresh manually.");
                        setConnectionStatus("disconnected");
                        return;
                    }
                    sessionStorage.setItem(retryKey, String(nextAttempts));
                    console.warn(`[sync] stuck — reloading (attempt ${nextAttempts}/${MAX_CONNECT_ATTEMPTS})`);
                    window.location.reload();
                }, 4000);

                p.on("sync", (isSynced: boolean) => {
                    if (isSynced) {
                        sessionStorage.removeItem(retryKey);
                        if (syncTimeout) {
                            clearTimeout(syncTimeout);
                            syncTimeout = null;
                        }
                    }
                });
            } catch (err) {
                if (!cancelled) {
                    setError(err instanceof ApiError ? err.message : "Failed to connect to the live session.");
                }
            }
        }

        connect();

        return () => {
            cancelled = true;
            if (syncTimeout) clearTimeout(syncTimeout);
            provider?.destroy();
            providerRef.current = null;
        };
    }, [workspaceId, documentId, ydoc]);
    useEffect(() => {
        function handleBeforeUnload() {
            const p = providerRef.current;
            if (p && p.ws && p.ws.readyState === WebSocket.OPEN) {
                p.awareness.setLocalState(p.awareness.getLocalState());
            }
        }
        window.addEventListener("beforeunload", handleBeforeUnload);
        return () => window.removeEventListener("beforeunload", handleBeforeUnload);
    }, []);

    const saveTitle = useCallback(
        async (value: string) => {
            setTitleStatus("saving");
            try {
                await apiClient.patch(`/api/workspaces/${workspaceId}/documents/${documentId}`, { title: value });
                setTitleStatus("saved");
            } catch {
                setTitleStatus("error");
            }
        },
        [workspaceId, documentId],
    );

    function handleTitleChange(e: ChangeEvent<HTMLInputElement>) {
        const value = e.target.value;
        setTitle(value);

        if (titleDebounceRef.current) clearTimeout(titleDebounceRef.current);
        titleDebounceRef.current = setTimeout(() => saveTitle(value), TITLE_AUTOSAVE_DELAY_MS);
    }

    function handleManualSave() {
        if (titleDebounceRef.current) {
            clearTimeout(titleDebounceRef.current);
            titleDebounceRef.current = null;
        }
        saveTitle(title);
    }

    useEffect(() => {
        return () => {
            if (titleDebounceRef.current) clearTimeout(titleDebounceRef.current);
        };
    }, []);

    if (loading) return <p>Loading document...</p>;

    return (
        <div>
            <p>
                <a href={`/workspaces/${workspaceId}${folderId ? `?folderId=${folderId}` : ""}`}>
                    ← Back to workspace
                </a>
            </p>

            {error && <p style={{ color: "red" }}>{error}</p>}

            <div>
                <input type="text" value={title} onChange={handleTitleChange} placeholder="Untitled" />
                <button onClick={handleManualSave} disabled={titleStatus === "saving"}>
                    {titleStatus === "saving" ? "Saving..." : "Save title"}
                </button>
                {titleStatus === "saved" && <span> Saved</span>}
                {titleStatus === "error" && <span style={{ color: "red" }}> Failed to save</span>}
            </div>

            <p>
                Live session: <strong>{connectionStatus}</strong>
                {connectionStatus === "disconnected" && (
                    <span style={{ color: "red" }}> — refresh the page to reconnect</span>
                )}
            </p>

            <EditorContent editor={editor} />
        </div>
    );
}

export default function DocumentEditorPage() {
    return (
        <RequireAuth>
            <DocumentEditorContent />
        </RequireAuth>
    );
}