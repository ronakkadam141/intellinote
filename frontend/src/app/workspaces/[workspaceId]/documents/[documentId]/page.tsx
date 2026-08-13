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
const SYNC_TIMEOUT_MS = 4000;
const MAX_CONNECT_ATTEMPTS = 4;

// Constants are fine at module scope — only hooks (useState etc.) must live
// inside the component. This was the actual bug: the useState calls below
// used to sit up here too.
const TEXT_ACTIONS = [
  { action: 'summarize', label: 'Summarize Selection' },
  { action: 'explain', label: 'Explain Simply' },
  { action: 'improve', label: 'Improve Writing' },
  { action: 'bullets', label: 'Convert to Bullet Points' },
  { action: 'quiz', label: 'Generate Quiz Questions' },
] as const;

type TextAction = typeof TEXT_ACTIONS[number]['action'];

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

    // Still needed — tracks the current selection so handleTextAction doesn't
    // need to reach into the editor closure a second time.
    const [selectedText, setSelectedText] = useState("");

    // Generalized AI-action state, correctly inside the component this time.
    // Removed the old summary/aiLoading/aiError state — it was a duplicate
    // of what these four now cover for all 5 actions, not just summarize.
    const [activeAction, setActiveAction] = useState<TextAction | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [actionResult, setActionResult] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);

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
        if (!editor) return;
        const activeEditor = editor; // narrowed non-null for this closure only

        function handleSelectionUpdate() {
            const { from, to } = activeEditor.state.selection;
            setSelectedText(activeEditor.state.doc.textBetween(from, to, " "));
        }

        activeEditor.on("selectionUpdate", handleSelectionUpdate);
        return () => {
            activeEditor.off("selectionUpdate", handleSelectionUpdate);
        };
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
                }, SYNC_TIMEOUT_MS);

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

    // Reads from `selectedText` state (already kept in sync by the
    // selectionUpdate effect above) instead of reaching for `activeEditor`,
    // which doesn't exist in this scope — that was the ReferenceError bug.
    const handleTextAction = async (action: TextAction) => {
        if (!selectedText.trim()) {
            setActionError('Select some text first.');
            return;
        }

        setActiveAction(action);
        setIsProcessing(true);
        setActionError(null);
        setActionResult(null);

        try {
            const response = await apiClient.post<{ action: string; result: string }>(
                `/api/workspaces/${workspaceId}/documents/${documentId}/ai/text`,
                { action, text: selectedText }
            );
            setActionResult(response.result);
        } catch (err) {
            if (err instanceof ApiError && err.status === 429) {
                setActionError('Too many AI requests — please wait a few minutes and try again.');
            } else {
                setActionError('AI action failed. Please try again.');
            }
        } finally {
            setIsProcessing(false);
        }
    };

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

            <div style={{ display: "flex", gap: "1rem", alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                    <EditorContent editor={editor} />
                </div>

                <aside
                    style={{
                        width: "280px",
                        flexShrink: 0,
                        border: "1px solid #ccc",
                        borderRadius: "6px",
                        padding: "1rem",
                        position: "sticky",
                        top: "1rem",
                    }}
                >
                    <h3 style={{ marginTop: 0 }}>AI Actions</h3>

                    {!selectedText.trim() && (
                        <p style={{ fontSize: "0.85rem", color: "#666" }}>Select some text in the document first.</p>
                    )}

                    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                        {TEXT_ACTIONS.map(({ action, label }) => (
                            <button
                                key={action}
                                onClick={() => handleTextAction(action)}
                                disabled={!selectedText.trim() || isProcessing}
                            >
                                {isProcessing && activeAction === action ? `${label}…` : label}
                            </button>
                        ))}
                    </div>

                    {actionError && <p style={{ color: "red" }}>{actionError}</p>}

                    {actionResult && activeAction && (
                        <div style={{ marginTop: "1rem" }}>
                            <strong>
                                {TEXT_ACTIONS.find((a) => a.action === activeAction)?.label} result:
                            </strong>
                            <p style={{ whiteSpace: "pre-wrap" }}>{actionResult}</p>
                        </div>
                    )}
                </aside>
            </div>
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