"use client";

import { useEffect, useRef, useState, useCallback, ChangeEvent, DragEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useEditor, EditorContent } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import RequireAuth from "@/components/RequireAuth";
import { apiClient, ApiError } from "@/lib/apiClient";
import ResizableImage from 'tiptap-extension-resize-image';
import { TextSelection } from "@tiptap/pm/state";

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

const TEXT_ACTIONS = [
  { action: 'summarize', label: 'Summarize Selection' },
  { action: 'explain', label: 'Explain Simply' },
  { action: 'improve', label: 'Improve Writing' },
  { action: 'bullets', label: 'Convert to Bullet Points' },
  { action: 'quiz', label: 'Generate Quiz Questions' },
] as const;

type TextAction = typeof TEXT_ACTIONS[number]['action'];

const IMAGE_ACTIONS = [
  { action: 'explainDiagram', label: 'Explain Diagram' },
  { action: 'summarizeImage', label: 'Summarize Image' },
  { action: 'extractNotes', label: 'Extract Notes' },
  { action: 'identifyConcepts', label: 'Identify Concepts' },
] as const;

type ImageAction = typeof IMAGE_ACTIONS[number]['action'];

type TitleStatus = "idle" | "saving" | "saved" | "error";
type ConnectionStatus = "connecting" | "connected" | "disconnected";

// One tab per AI action run, whether text or image. Replaces the old
// separate text/image result state entirely — a single unified model is
// what makes "new action replaces the old one" and "tabbed results" fall
// out naturally, instead of fighting two parallel state groups.
type AiTabKind = 'text' | 'image';

interface AiResultTab {
    id: string;
    kind: AiTabKind;
    label: string;
    status: 'loading' | 'done' | 'error';
    result: string | null;
    error: string | null;
}

function extractErrorMessage(err: unknown): string {
    if (err instanceof ApiError && err.status === 429) {
        return 'Too many AI requests — please wait a few minutes and try again.';
    }
    if (err instanceof ApiError && err.code === 'AI_TIMEOUT') {
        return 'The AI is taking longer than usual — please try again.';
    }
    return 'AI action failed. Please try again.';
}

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

    const [selectedText, setSelectedText] = useState("");

    // AI result tabs — replaces activeAction/isProcessing/actionResult/
    // actionError and activeImageAction/isProcessingImage/imageActionResult/
    // imageActionError entirely.
    const [tabs, setTabs] = useState<AiResultTab[]>([]);
    const [activeTabId, setActiveTabId] = useState<string | null>(null);
    // Validation message ("select some text first") isn't a real AI result,
    // so it doesn't get a tab — it's a lightweight transient message shown
    // above the tab strip instead.
    const [formError, setFormError] = useState<string | null>(null);
    const draggedTabIdRef = useRef<string | null>(null);

    const [selectedImage, setSelectedImage] = useState<{ src: string; top: number; left: number } | null>(null);

    const [isUploadingImage, setIsUploadingImage] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const editorWrapperRef = useRef<HTMLDivElement | null>(null);

    const [workspaceRole, setWorkspaceRole] = useState<'owner' | 'editor' | 'viewer' | null>(null);
    const canEdit = workspaceRole === 'owner' || workspaceRole === 'editor';

    const toolbarRef = useRef<HTMLDivElement | null>(null);
    const selectedImageWrapperRef = useRef<HTMLElement | null>(null);

    const editor = useEditor({
        immediatelyRender: false,
        extensions: [
            StarterKit.configure({ undoRedo: false }),
            Collaboration.configure({ document: ydoc, field: YJS_FIELD_NAME }),
            ResizableImage,
        ],
        editorProps: {
            attributes: {
                class: "border rounded p-4 min-h-[300px] focus:outline-none",
            },
        },
        
    });

    const clearImageSelection = useCallback(() => {
        setSelectedImage(null);
        selectedImageWrapperRef.current = null;
        if (editor && !editor.isDestroyed) {
            const { state, view } = editor;
            const pos = Math.min(state.selection.to, state.doc.content.size);
            const resolved = state.doc.resolve(pos);
            const safeSelection = TextSelection.near(resolved);
            view.dispatch(state.tr.setSelection(safeSelection));
        }
    }, [editor]);

    useEffect(() => {
        if (editor && !editor.isDestroyed) {
            editor.setEditable(canEdit);
        }
    }, [editor, canEdit]);

    useEffect(() => {
        if (!editor) return;
        const activeEditor = editor;

        function handleSelectionUpdate() {
            const { selection } = activeEditor.state;
            const { from, to } = selection;
            setSelectedText(activeEditor.state.doc.textBetween(from, to, " "));

            if (selection instanceof NodeSelection && /image/i.test(selection.node.type.name)) {
                const dom = activeEditor.view.nodeDOM(selection.from) as HTMLElement | null;
                const wrapperEl = editorWrapperRef.current;
                if (dom && wrapperEl) {
                    const imgRect = dom.getBoundingClientRect();
                    const wrapperRect = wrapperEl.getBoundingClientRect();
                    selectedImageWrapperRef.current = dom;
                    setSelectedImage({
                        src: selection.node.attrs.src,
                        top: imgRect.top - wrapperRect.top,
                        left: imgRect.left - wrapperRect.left,
                    });
                    return;
                }
            }
            selectedImageWrapperRef.current = null;
            setSelectedImage(null);
        }

        activeEditor.on("selectionUpdate", handleSelectionUpdate);
        return () => {
            activeEditor.off("selectionUpdate", handleSelectionUpdate);
        };
    }, [editor]);

    // Loads this document's own details (title, folder) and the current
    // user's role in the workspace. This page only ever needs data about
    // ITSELF — no folder/document browsing or member list belongs here;
    // that's the workspace page's job.
    useEffect(() => {
        let cancelled = false;

        Promise.all([
            apiClient.get<{ document: DocumentDetail }>(`/api/workspaces/${workspaceId}/documents/${documentId}`),
            apiClient.get<{ role: 'owner' | 'editor' | 'viewer' }>(`/api/workspaces/${workspaceId}/members/me`),
        ])
            .then(([docRes, memberRes]) => {
                if (cancelled) return;
                setTitle(docRes.document.title);
                setFolderId(docRes.document.folderId);
                setWorkspaceRole(memberRes.role);
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

    useEffect(() => {
        if (!editor) return;
        const editorDom = editor.view.dom as HTMLElement;

        function closestEl(node: Node): HTMLElement | null {
            return node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
        }

        function handleMouseDownCapture(e: MouseEvent) {
            const target = e.target as Node;
            if (toolbarRef.current?.contains(target)) return;

            const el = closestEl(target);
            const wrapperEl = el?.closest('[contenteditable="false"][draggable="true"]') as HTMLElement | null;

            if (wrapperEl && editorDom.contains(wrapperEl)) {
                const imgEl = wrapperEl.querySelector('img') as HTMLElement | null;
                const rect = imgEl?.getBoundingClientRect();
                const PAD = 12;
                const withinImage =
                    !!rect &&
                    e.clientX >= rect.left - PAD &&
                    e.clientX <= rect.right + PAD &&
                    e.clientY >= rect.top - PAD &&
                    e.clientY <= rect.bottom + PAD;

                if (withinImage) {
                    if (wrapperEl === selectedImageWrapperRef.current) {
                        e.preventDefault();
                        e.stopPropagation();
                        clearImageSelection();
                    }
                    return;
                }

                e.preventDefault();
                e.stopPropagation();
                if (selectedImage) clearImageSelection();
                return;
            }

            if (selectedImage) {
                clearImageSelection();
            }
        }

        document.addEventListener('mousedown', handleMouseDownCapture, true);
        return () => document.removeEventListener('mousedown', handleMouseDownCapture, true);
    }, [editor, selectedImage, clearImageSelection]);

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

    const handleImageFileSelected = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file || !editor) return;

        setUploadError(null);
        setIsUploadingImage(true);

        try {
            const formData = new FormData();
            formData.append('image', file);
            formData.append('documentId', documentId);

            const response = await apiClient.post<{ imageUrl: string }>(
                `/api/workspaces/${workspaceId}/images`,
                formData
            );

            editor.chain().focus().setImage({ src: response.imageUrl }).run();
        } catch (err) {
            if (err instanceof ApiError && err.status === 403) {
                setUploadError("You don't have permission to add images to this document.");
            } else if (err instanceof ApiError && err.status === 400) {
                setUploadError(err.message || 'Image upload failed — check file type/size.');
            } else {
                setUploadError('Image upload failed. Please try again.');
            }
        } finally {
            setIsUploadingImage(false);
        }
    };

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

    // Creates a new tab immediately (status 'loading') and makes it active,
    // then fills it in on response. Every call — text or image — produces
    // its own independent tab; nothing here blocks other actions from
    // running concurrently.
    const handleTextAction = async (action: TextAction) => {
        if (!selectedText.trim()) {
            setFormError('Select some text first.');
            return;
        }
        setFormError(null);

        const tabId = crypto.randomUUID();
        const label = TEXT_ACTIONS.find((a) => a.action === action)?.label ?? action;
        setTabs((prev) => [...prev, { id: tabId, kind: 'text', label, status: 'loading', result: null, error: null }]);
        setActiveTabId(tabId);

        try {
            const response = await apiClient.post<{ action: string; result: string }>(
                `/api/workspaces/${workspaceId}/documents/${documentId}/ai/text`,
                { action, text: selectedText }
            );
            setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, status: 'done', result: response.result } : t)));
        } catch (err) {
            const message = extractErrorMessage(err);
            setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, status: 'error', error: message } : t)));
        }
    };

    const handleImageAction = async (action: ImageAction) => {
        if (!selectedImage) return;
        const imageUrl = selectedImage.src;
        clearImageSelection();

        const tabId = crypto.randomUUID();
        const label = IMAGE_ACTIONS.find((a) => a.action === action)?.label ?? action;
        setTabs((prev) => [...prev, { id: tabId, kind: 'image', label, status: 'loading', result: null, error: null }]);
        setActiveTabId(tabId);

        try {
            const response = await apiClient.post<{ action: string; result: string }>(
                `/api/workspaces/${workspaceId}/documents/${documentId}/ai/image`,
                { action, imageUrl }
            );
            setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, status: 'done', result: response.result } : t)));
        } catch (err) {
            const message = extractErrorMessage(err);
            setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, status: 'error', error: message } : t)));
        }
    };

    // Closing a tab activates its former neighbor (whatever's now at the
    // same index, or the previous one if it was last) — same convention
    // browsers use, so focus doesn't jump unpredictably.
    function closeTab(id: string) {
        setTabs((prev) => {
            const idx = prev.findIndex((t) => t.id === id);
            const next = prev.filter((t) => t.id !== id);
            if (activeTabId === id) {
                const fallback = next[idx] ?? next[idx - 1] ?? null;
                setActiveTabId(fallback ? fallback.id : null);
            }
            return next;
        });
    }

    // Native HTML5 drag and drop for reordering — no library needed for
    // this scale. dragStart records the source tab id in a ref (simpler
    // than reading dataTransfer, which has cross-browser quirks for
    // same-page reordering); drop splices it to the target's position.
    function handleTabDragStart(id: string) {
        draggedTabIdRef.current = id;
    }
    function handleTabDragOver(e: DragEvent) {
        e.preventDefault();
    }
    function handleTabDrop(targetId: string) {
        const sourceId = draggedTabIdRef.current;
        draggedTabIdRef.current = null;
        if (!sourceId || sourceId === targetId) return;
        setTabs((prev) => {
            const sourceIdx = prev.findIndex((t) => t.id === sourceId);
            const targetIdx = prev.findIndex((t) => t.id === targetId);
            if (sourceIdx === -1 || targetIdx === -1) return prev;
            const next = [...prev];
            const [moved] = next.splice(sourceIdx, 1);
            next.splice(targetIdx, 0, moved);
            return next;
        });
    }

    useEffect(() => {
        return () => {
            if (titleDebounceRef.current) clearTimeout(titleDebounceRef.current);
        };
    }, []);

    if (loading) return <p>Loading document...</p>;

    const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;


    return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
        <p>
            <Link href={`/workspaces/${workspaceId}${folderId ? `?folderId=${folderId}` : ""}`}>
                ← Back to workspace
            </Link>
        </p>

        {error && <p className="error-text">{error}</p>}

        <div>
            <input type="text" value={title} onChange={handleTitleChange} placeholder="Untitled" />
            <button onClick={handleManualSave} disabled={titleStatus === "saving"}>
                {titleStatus === "saving" ? "Saving..." : "Save title"}
            </button>
            {titleStatus === "saved" && <span> Saved</span>}
            {titleStatus === "error" && <span className="error-text"> Failed to save</span>}
        </div>

        <p>
            Live session: <strong>{connectionStatus}</strong>
            {connectionStatus === "disconnected" && (
                <span className="error-text"> — refresh the page to reconnect</span>
            )}
        </p>

        <div style={{ display: "flex", gap: "1rem", alignItems: "stretch", flex: 1, minHeight: 0 }}>
            <div ref={editorWrapperRef} style={{ flex: 1, position: "relative", overflowY: "auto" }}>
                <EditorContent editor={editor} />

                {selectedImage && (
                    <div
                        ref={toolbarRef}
                        style={{
                            position: "absolute",
                            top: selectedImage.top + 34,
                            left: selectedImage.left + 6,
                            display: "flex",
                            gap: "0.25rem",
                            background: "var(--surface-2)",
                            border: "1px solid var(--border)",
                            borderRadius: "4px",
                            padding: "0.25rem",
                            zIndex: 10,
                        }}
                    >
                        {IMAGE_ACTIONS.map(({ action, label }) => (
                            <button
                                key={action}
                                onClick={() => handleImageAction(action)}
                                className="btn-primary"
                                style={{ width: "auto", padding: "0.3rem 0.5rem", fontSize: "0.75rem" }}
                                title={label}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            <aside
                style={{
                    width: "320px",
                    flexShrink: 0,
                    border: "1px solid var(--border)",
                    background: "var(--surface)",
                    borderRadius: "6px",
                    padding: "1rem",
                    overflowY: "auto",
                }}
            >
                <h3 style={{ marginTop: 0 }}>AI Actions</h3>

                {!selectedText.trim() && !selectedImage && (
                    <p className="muted">
                        Select text, or click an image, to see AI actions.
                    </p>
                )}

                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    {TEXT_ACTIONS.map(({ action, label }) => (
                        <button
                            key={action}
                            onClick={() => handleTextAction(action)}
                            disabled={!selectedText.trim()}
                            className="btn-primary"
                            style={{ width: "100%" }}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                {canEdit && (
                    <div style={{ margin: '0.75rem 0' }}>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            onChange={handleImageFileSelected}
                            style={{ display: 'none' }}
                        />
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isUploadingImage}
                            className="btn-primary"
                            style={{ width: "100%" }}
                        >
                            {isUploadingImage ? 'Uploading...' : 'Insert Image'}
                        </button>
                        {uploadError && <p className="error-text">{uploadError}</p>}
                    </div>
                )}

                {formError && <p className="error-text">{formError}</p>}

                {/* Tab strip — one tab per AI action run, draggable to
                    reorder, closable, browser-tab style. */}
                {tabs.length > 0 && (
                    <div
                        style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "2px",
                            borderBottom: "1px solid var(--border)",
                            marginTop: "1rem",
                        }}
                    >
                        {tabs.map((tab) => (
                            <div
                                key={tab.id}
                                draggable
                                onDragStart={() => handleTabDragStart(tab.id)}
                                onDragOver={handleTabDragOver}
                                onDrop={() => handleTabDrop(tab.id)}
                                onClick={() => setActiveTabId(tab.id)}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "6px",
                                    padding: "0.35rem 0.5rem",
                                    fontSize: "12px",
                                    cursor: "pointer",
                                    borderBottom: activeTabId === tab.id ? "2px solid var(--accent)" : "2px solid transparent",
                                    color: activeTabId === tab.id ? "var(--text)" : "var(--text-muted)",
                                    maxWidth: "130px",
                                }}
                                title={tab.label}
                            >
                                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {tab.status === 'loading' ? '… ' : tab.status === 'error' ? '⚠ ' : ''}
                                    {tab.label}
                                </span>
                                <span
                                    onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                                    style={{ color: "var(--text-muted)", lineHeight: 1 }}
                                    aria-label={`Close ${tab.label} tab`}
                                >
                                    ×
                                </span>
                            </div>
                        ))}
                    </div>
                )}

                {activeTab && (
                    <div style={{ marginTop: "0.75rem" }}>
                        {activeTab.status === 'loading' && <p className="muted">Performing action…</p>}
                        {activeTab.status === 'error' && <p className="error-text">{activeTab.error}</p>}
                        {activeTab.status === 'done' && <p style={{ whiteSpace: "pre-wrap" }}>{activeTab.result}</p>}
                    </div>
                )}
            </aside>
        </div>
    </div>
)};
export default function DocumentEditorPage() {
    return (
        <RequireAuth>
            <DocumentEditorContent />
        </RequireAuth>
    );
}