"use client";

import { useEffect, useRef, useState, useCallback, ChangeEvent } from "react";
import { useParams } from "next/navigation";
import { useEditor, EditorContent } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import RequireAuth from "@/components/RequireAuth";
import { apiClient, ApiError } from "@/lib/apiClient";
import ResizableImage from 'tiptap-extension-resize-image';

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

// Mirrors TEXT_ACTIONS. Values must match backend VALID_IMAGE_ACTIONS exactly.
const IMAGE_ACTIONS = [
  { action: 'explainDiagram', label: 'Explain Diagram' },
  { action: 'summarizeImage', label: 'Summarize Image' },
  { action: 'extractNotes', label: 'Extract Notes' },
  { action: 'identifyConcepts', label: 'Identify Concepts' },
] as const;

type ImageAction = typeof IMAGE_ACTIONS[number]['action'];

type TitleStatus = "idle" | "saving" | "saved" | "error";
type ConnectionStatus = "connecting" | "connected" | "disconnected";

// Minimal shared button styling — Tailwind preflight strips native button
// chrome (border/background), which is why buttons were rendering as bare
// text. Not a new stylesheet, just inline style objects.
const actionButtonStyle: React.CSSProperties = {
    padding: "0.4rem 0.6rem",
    border: "1px solid #444",
    borderRadius: "4px",
    background: "#1f1f1f",
    color: "inherit",
    cursor: "pointer",
    textAlign: "left",
    width: "100%",
};

const primaryButtonStyle: React.CSSProperties = {
    ...actionButtonStyle,
    background: "#2563eb",
    borderColor: "#2563eb",
    color: "#fff",
};

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

    const [activeAction, setActiveAction] = useState<TextAction | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [actionResult, setActionResult] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);

    // Image-selection + image-action state, same shape as text actions.
    const [selectedImage, setSelectedImage] = useState<{ src: string; top: number; left: number } | null>(null);
    const [activeImageAction, setActiveImageAction] = useState<ImageAction | null>(null);
    const [isProcessingImage, setIsProcessingImage] = useState(false);
    const [imageActionResult, setImageActionResult] = useState<string | null>(null);
    const [imageActionError, setImageActionError] = useState<string | null>(null);

    const [isUploadingImage, setIsUploadingImage] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    // Wraps EditorContent so the floating toolbar can be positioned
    // relative to it instead of the viewport.
    const editorWrapperRef = useRef<HTMLDivElement | null>(null);

    const [workspaceRole, setWorkspaceRole] = useState<'owner' | 'editor' | 'viewer' | null>(null);
    const canEdit = workspaceRole === 'owner' || workspaceRole === 'editor';

    // Tracks the toolbar's own DOM node and the currently-selected image's
    // DOM node, so the click-outside listener below can tell the difference
    // between "click the toolbar/image" (ignore) and "click anywhere else"
    // (close the toolbar).
    const toolbarRef = useRef<HTMLDivElement | null>(null);
    const selectedImageDomRef = useRef<HTMLElement | null>(null);
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

    // Clears our toolbar state AND actually moves Tiptap's selection off the
    // image node. Without this, ProseMirror still considers the image
    // "selected" (leaving its highlight box up), and clicking the same
    // image again wouldn't fire a new selectionUpdate event since the
    // selection wouldn't actually be changing.
    const clearImageSelection = useCallback(() => {
        setSelectedImage(null);
        selectedImageWrapperRef.current = null; // renamed
        if (editor && !editor.isDestroyed) {
            editor.commands.setTextSelection(editor.state.selection.to);
        }
    }, [editor]);

    useEffect(() => {
        if (!editor) return;
        const activeEditor = editor;

        function handleSelectionUpdate() {
            const { selection } = activeEditor.state;
            const { from, to } = selection;
            setSelectedText(activeEditor.state.doc.textBetween(from, to, " "));

            // Detect an image node selection and compute toolbar position.
            // tiptap-extension-resize-image registers its node under the name
            // "imageResize" in most versions; matching case-insensitively on
            // "image" covers that and the plain @tiptap/extension-image name
            // without hardcoding a version-specific string.
            if (selection instanceof NodeSelection && /image/i.test(selection.node.type.name)) {
                const dom = activeEditor.view.nodeDOM(selection.from) as HTMLElement | null;
                const wrapperEl = editorWrapperRef.current;
                if (dom && wrapperEl) {
                    const imgRect = dom.getBoundingClientRect();
                    const wrapperRect = wrapperEl.getBoundingClientRect();
                    selectedImageWrapperRef.current = dom; // the NodeView wrapper, not just <img>
                    setSelectedImage({
                        src: selection.node.attrs.src,
                        top: imgRect.top - wrapperRect.top,
                        left: imgRect.left - wrapperRect.left,
                    });
                    return;
                }
            }
            selectedImageDomRef.current = null;
            setSelectedImage(null);
        }

        activeEditor.on("selectionUpdate", handleSelectionUpdate);
        return () => {
            activeEditor.off("selectionUpdate", handleSelectionUpdate);
        };
    }, [editor]);

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

    // Closes the image toolbar on any click that isn't on the toolbar itself
    // or on the currently-selected image. This is the single source of truth
    // for dismissal — it covers clicks outside the editor, clicks on empty
    // space inside the editor, and clicks anywhere else on the page, all in
    // one path, rather than relying on Tiptap's selectionUpdate event (which
    // doesn't reliably fire for clicks on empty space that ProseMirror can't
    // map to a new document position).
    // Two-tier dismissal:
    // 1. Click genuinely outside the image's NodeView wrapper (real text,
    //    blank page) — dismiss normally, let the click proceed as usual.
    // 2. Click inside the wrapper but outside the visible <img> itself (the
    //    NodeView's invisible flex-alignment padding) — dismiss AND stop the
    //    event from reaching ProseMirror's own handler. Without this,
    //    ProseMirror treats any click on this contentEditable="false" node as
    //    "select the image," reselecting it right after we just cleared it —
    //    which is what caused the disappear-then-reappear flicker.
    // Single source of truth for image-toolbar selection/dismissal. Runs on
// EVERY mousedown inside the document (capture phase, before ProseMirror's
// own handler), not just when an image is already selected — this is
// necessary because tiptap-extension-resize-image's NodeView wrapper is
// contentEditable="false", so ProseMirror selects the whole node on any
// click inside that wrapper, including its invisible flex-alignment
// padding on either side of the actual image. We derive the wrapper fresh
// from the click target each time via closest(), rather than trusting
// stale state, so this works correctly even on the very first click before
// anything is selected.
    useEffect(() => {
        if (!editor) return;
        const editorDom = editor.view.dom as HTMLElement;

        function closestEl(node: Node): HTMLElement | null {
            return node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
        }

        function handleMouseDownCapture(e: MouseEvent) {
            const target = e.target as Node;
            if (toolbarRef.current?.contains(target)) return; // let the button's onClick fire normally

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
                        // Same image, already selected — treat as a toggle-close
                        // instead of letting ProseMirror just reselect the same node.
                        e.preventDefault();
                        e.stopPropagation();
                        clearImageSelection();
                    }
                    // A different (not-yet-selected) image — let ProseMirror's
                    // default behavior run so it actually selects this node,
                    // which triggers handleSelectionUpdate normally.
                    return;
                }

                // Click landed in the wrapper's dead-zone padding, not on the
                // visible image itself — block ProseMirror from selecting the
                // node at all, so no toolbar ever appears from this click.
                e.preventDefault();
                e.stopPropagation();
                if (selectedImage) clearImageSelection();
                return;
            }

            // Click is genuinely elsewhere (real text, blank editor space,
            // outside the editor entirely) — dismiss if something's selected,
            // otherwise do nothing and let the click proceed as normal.
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
            } else if (err instanceof ApiError && err.code === 'AI_TIMEOUT') {
                setActionError('The AI is taking longer than usual — please try again.');
            } else {
                setActionError('AI action failed. Please try again.');
            }
        } finally {
            setIsProcessing(false);
        }
    };

    // Same shape as handleTextAction, hits the image endpoint instead.
    const handleImageAction = async (action: ImageAction) => {
        if (!selectedImage) return;
        const imageUrl = selectedImage.src; // capture before clearing state below

        setActiveImageAction(action);
        setIsProcessingImage(true);
        setImageActionError(null);
        setImageActionResult(null);
        clearImageSelection(); // hide toolbar + deselect image immediately on click

        try {
            const response = await apiClient.post<{ action: string; result: string }>(
                `/api/workspaces/${workspaceId}/documents/${documentId}/ai/image`,
                { action, imageUrl }
            );
            setImageActionResult(response.result);
        } catch (err) {
            if (err instanceof ApiError && err.status === 429) {
                setImageActionError('Too many AI requests — please wait a few minutes and try again.');
            } else if (err instanceof ApiError && err.code === 'AI_TIMEOUT') {
                setImageActionError('The AI is taking longer than usual — please try again.');
            } else {
                setImageActionError('AI action failed. Please try again.');
            }
        } finally {
            setIsProcessingImage(false);
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
                <button style={actionButtonStyle} onClick={handleManualSave} disabled={titleStatus === "saving"}>
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
                <div ref={editorWrapperRef} style={{ flex: 1, position: "relative" }}>
                    <EditorContent editor={editor} />

                    {/* Floating toolbar, inset into the selected image's own
                        top-left corner so it can never collide with
                        surrounding text regardless of layout. Offset by 34px
                        vertically to clear tiptap-extension-resize-image's
                        own align-icon row, which renders directly above the
                        image at selection time. */}
                    {selectedImage && (
                        <div
                            ref={toolbarRef}
                            style={{
                                position: "absolute",
                                top: selectedImage.top + 34,
                                left: selectedImage.left + 6,
                                display: "flex",
                                gap: "0.25rem",
                                background: "rgba(17, 17, 17, 0.9)",
                                border: "1px solid #444",
                                borderRadius: "4px",
                                padding: "0.25rem",
                                zIndex: 10,
                            }}
                        >
                            {IMAGE_ACTIONS.map(({ action, label }) => (
                                <button
                                    key={action}
                                    onClick={() => handleImageAction(action)}
                                    disabled={isProcessingImage}
                                    style={{
                                        ...primaryButtonStyle,
                                        width: "auto",
                                        padding: "0.3rem 0.5rem",
                                        fontSize: "0.75rem",
                                    }}
                                    title={label}
                                >
                                    {isProcessingImage && activeImageAction === action ? "…" : label}
                                </button>
                            ))}
                        </div>
                    )}
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

                    {!selectedText.trim() && !selectedImage && (
                        <p style={{ fontSize: "0.85rem", color: "#666" }}>
                            Select text, or click an image, to see AI actions.
                        </p>
                    )}

                    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                        {TEXT_ACTIONS.map(({ action, label }) => (
                            <button
                                key={action}
                                style={actionButtonStyle}
                                onClick={() => handleTextAction(action)}
                                disabled={!selectedText.trim() || isProcessing}
                            >
                                {isProcessing && activeAction === action ? `${label}…` : label}
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
                                style={actionButtonStyle}
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isUploadingImage}
                            >
                                {isUploadingImage ? 'Uploading...' : 'Insert Image'}
                            </button>
                            {uploadError && <p style={{ color: 'red' }}>{uploadError}</p>}
                        </div>
                    )}

                    {actionError && <p style={{ color: "red" }}>{actionError}</p>}

                    {actionResult && activeAction && (
                        <div style={{ marginTop: "1rem" }}>
                            <strong>
                                {TEXT_ACTIONS.find((a) => a.action === activeAction)?.label} result:
                            </strong>
                            <p style={{ whiteSpace: "pre-wrap" }}>{actionResult}</p>
                        </div>
                    )}

                    {/* Image action result, same pattern as text result above */}
                    {imageActionError && <p style={{ color: "red" }}>{imageActionError}</p>}

                    {isProcessingImage && activeImageAction && (
                        <div style={{ marginTop: "1rem" }}>
                            <strong>
                                {IMAGE_ACTIONS.find((a) => a.action === activeImageAction)?.label} result:
                            </strong>
                            <p style={{ color: "#888" }}>Performing action…</p>
                        </div>
                    )}

                    {!isProcessingImage && imageActionResult && activeImageAction && (
                        <div style={{ marginTop: "1rem" }}>
                            <strong>
                                {IMAGE_ACTIONS.find((a) => a.action === activeImageAction)?.label} result:
                            </strong>
                            <p style={{ whiteSpace: "pre-wrap" }}>{imageActionResult}</p>
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