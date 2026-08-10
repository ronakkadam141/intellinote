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

// Minimal local shape of what getDocumentById returns — if a fuller
// Document type already exists in types/document.ts, swap this out for it.
interface DocumentDetail {
    id: string;
    title: string;
    workspaceId: string;
    folderId: string | null;
}

// MUST match YJS_FIELD_NAME in backend/src/lib/yjsServer.js exactly, and
// is also Tiptap's own default — kept explicit here so the two stay in sync
// on purpose, not by coincidence.
const YJS_FIELD_NAME = "default";

const TITLE_AUTOSAVE_DELAY_MS = 1500;

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

    // Created once, synchronously, so it's available immediately for useEditor
    // below — the network connection (WebsocketProvider) is attached later,
    // asynchronously, once a ticket has been fetched. The Y.Doc itself needs
    // no network to exist.
    const [ydoc] = useState(() => new Y.Doc());

    const editor = useEditor({
        immediatelyRender: false, // required for Next.js SSR — see project notes
        extensions: [
            StarterKit.configure({ undoRedo: false }), // Collaboration brings its own history
            Collaboration.configure({ document: ydoc, field: YJS_FIELD_NAME }),
        ],
        editorProps: {
            attributes: {
                class: "border rounded p-4 min-h-[300px] focus:outline-none",
            },
        },
    });

    // Load document metadata (title, folderId) via the normal REST endpoint.
    // This is NOT where editor content comes from — that arrives via the Yjs
    // sync below. This is only for the title field and the "back" link.
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
    // already-existing ydoc. Cleaned up on unmount or if the params change.
    useEffect(() => {
        let cancelled = false;
        let provider: WebsocketProvider | null = null;

        async function connect() {
            try {
                const { ticket } = await apiClient.post<{ ticket: string }>(
                    `/api/workspaces/${workspaceId}/documents/${documentId}/ws-ticket`,
                );
                if (cancelled) return;

                const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "";
                const wsBase = apiUrl.replace(/^http/, "ws"); // http->ws, https->wss

                provider = new WebsocketProvider(`${wsBase}/ws`, documentId, ydoc, {
                    params: { ticket },
                    // Our ticket is single-use, so a dropped connection can never
                    // be recovered by blindly retrying with the same one — that
                    // was causing an infinite failed-reconnect loop. Disable
                    // auto-reconnect entirely for now and surface a clear message
                    // instead; fetching a fresh ticket on reconnect is a real
                    // fast-follow, not implemented in this pass.
                    shouldReconnect: () => false,
                });

                provider.on("status", ({ status }: { status: ConnectionStatus }) => {
                    if (!cancelled) setConnectionStatus(status);
                });

                provider.on("closed", () => {
                    if (!cancelled) setConnectionStatus("disconnected");
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
            provider?.destroy();
        };
    }, [workspaceId, documentId, ydoc]);

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

    // Clear any pending debounce on unmount so it doesn't fire after leaving.
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