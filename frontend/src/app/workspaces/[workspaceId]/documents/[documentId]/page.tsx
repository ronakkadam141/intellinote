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
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import * as awarenessProtocol from "y-protocols/awareness";
import { useAuth } from "@/context/AuthContext";

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
  { action: 'summarize', label: 'Summarize' },
  { action: 'explain', label: 'Explain Simply' },
  { action: 'improve', label: 'Improve Writing' },
  { action: 'bullets', label: 'To Bullets' },
  { action: 'quiz', label: 'Quiz Me' },
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

type AiTabKind = 'text' | 'image';

interface AiResultTab {
    id: string;
    kind: AiTabKind;
    label: string;
    action: TextAction | ImageAction;
    status: 'loading' | 'done' | 'error';
    result: string | null;
    error: string | null;
    sourceText?: string;
    fromPos?: number;
    toPos?: number;
    color?: string;
    inserted?: boolean;
}
interface OnlineUser {
    clientId: number;
    name: string;
    color: string;
}

interface SelectionToolbarState {
    from: number;
    to: number;
    text: string;
    top: number;
    left: number;
}

interface GutterPosition {
    top: number;
    left: number;
}

const CURSOR_COLORS = ["#e07a5f", "#81b29a", "#3d5a80", "#f2cc8f", "#9b5de5", "#00b4d8"];
const TAB_COLORS = ["#C77B3F", "#8FA876", "#5B8AA6", "#C9A227", "#9B6B9E"];

function colorForUser(userId: string | undefined): string {
    if (!userId) return CURSOR_COLORS[0];
    let hash = 0;
    for (let i = 0; i < userId.length; i++) hash = userId.charCodeAt(i) + ((hash << 5) - hash);
    return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length];
}

function initialsFor(name: string): string {
    return name.trim().slice(0, 2).toUpperCase() || "?";
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
    const [awareness] = useState(() => new awarenessProtocol.Awareness(ydoc));
    const { user } = useAuth();
    const [selectedText, setSelectedText] = useState("");

    const [tabs, setTabs] = useState<AiResultTab[]>([]);
    const [formError, setFormError] = useState<string | null>(null);
    const draggedTabIdRef = useRef<string | null>(null);
    const tabColorCounterRef = useRef(0);
    const [aiPanelOpen, setAiPanelOpen] = useState(true);

    const [selectionToolbar, setSelectionToolbar] = useState<SelectionToolbarState | null>(null);
    const selectionToolbarRef = useRef<HTMLDivElement | null>(null);

    const [gutterPositions, setGutterPositions] = useState<Record<string, GutterPosition>>({});

    const [selectedImage, setSelectedImage] = useState<{ src: string; top: number; left: number } | null>(null);

    const [isUploadingImage, setIsUploadingImage] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const editorWrapperRef = useRef<HTMLDivElement | null>(null);

    const [workspaceRole, setWorkspaceRole] = useState<'owner' | 'editor' | 'viewer' | null>(null);
    const canEdit = workspaceRole === 'owner' || workspaceRole === 'editor';

    const toolbarRef = useRef<HTMLDivElement | null>(null);
    const selectedImageWrapperRef = useRef<HTMLElement | null>(null);
    const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);

    const editor = useEditor({
        immediatelyRender: false,
        extensions: [
            StarterKit.configure({ undoRedo: false }),
            Collaboration.configure({ document: ydoc, field: YJS_FIELD_NAME }),
            ResizableImage,
            CollaborationCursor.configure({
                provider: { awareness },
                user: {
                    name: user?.displayName || user?.email || "Anonymous",
                    color: colorForUser(user?.id),
                },
            }),
        ],
        editorProps: {
            attributes: {
                class: "focus:outline-none",
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

    const recomputeGutterFromTabs = useCallback((tabList: AiResultTab[]) => {
        if (!editor || editor.isDestroyed || !editorWrapperRef.current) return;
        const wrapperRect = editorWrapperRef.current.getBoundingClientRect();
        const scrollTop = editorWrapperRef.current.scrollTop;
        const next: Record<string, GutterPosition> = {};
        tabList.forEach((t) => {
            if (t.kind !== 'text' || t.fromPos == null) return;
            try {
                const coords = editor.view.coordsAtPos(t.fromPos);
                next[t.id] = {
                    top: coords.top - wrapperRect.top + scrollTop,
                    left: coords.left - wrapperRect.left - 18,
                };
            } catch {
                // position no longer resolves (doc shrank past it) — skip.
            }
        });
        setGutterPositions(next);
    }, [editor]);

    useEffect(() => {
        recomputeGutterFromTabs(tabs);
    }, [tabs, recomputeGutterFromTabs, aiPanelOpen]);

    useEffect(() => {
        function handleResize() { recomputeGutterFromTabs(tabs); }
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [tabs, recomputeGutterFromTabs]);

    useEffect(() => {
        if (!editor) return;
        function syncPositionsAfterTransaction({ transaction }: { transaction: { docChanged: boolean; mapping: { map: (pos: number) => number } } }) {
            if (!transaction.docChanged) return;
            setTabs((prev) => {
                const mapped = prev.map((t) =>
                    t.fromPos != null && t.toPos != null
                        ? { ...t, fromPos: transaction.mapping.map(t.fromPos), toPos: transaction.mapping.map(t.toPos) }
                        : t
                );
                recomputeGutterFromTabs(mapped);
                return mapped;
            });
        }
        editor.on('transaction', syncPositionsAfterTransaction);
        return () => { editor.off('transaction', syncPositionsAfterTransaction); };
    }, [editor, recomputeGutterFromTabs]);

    useEffect(() => {
        const wrapper = editorWrapperRef.current;
        if (!wrapper) return;
        function handleScroll() { setSelectionToolbar(null); }
        wrapper.addEventListener('scroll', handleScroll);
        return () => wrapper.removeEventListener('scroll', handleScroll);
    }, []);

    useEffect(() => {
        function updatePresence() {
            const states = Array.from(awareness.getStates().entries());
            const others: OnlineUser[] = states
                .filter(([clientId, state]) => state?.user && clientId !== awareness.clientID)
                .map(([clientId, state]) => ({
                    clientId,
                    name: state.user.name,
                    color: state.user.color,
                }));
            setOnlineUsers(others);
        }

        awareness.on("change", updatePresence);
        updatePresence();

        return () => {
            awareness.off("change", updatePresence);
        };
    }, [awareness]);

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
            const text = activeEditor.state.doc.textBetween(from, to, " ");
            setSelectedText(text);

            const isImageNode = selection instanceof NodeSelection && /image/i.test(selection.node.type.name);

            if (isImageNode) {
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
                }
                setSelectionToolbar(null);
                return;
            }

            selectedImageWrapperRef.current = null;
            setSelectedImage(null);

            if (text.trim().length > 0) {
                const coords = activeEditor.view.coordsAtPos(from);
                setSelectionToolbar({ from, to, text, top: coords.top, left: coords.left });
            } else {
                setSelectionToolbar(null);
            }
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
                    awareness,
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
    }, [workspaceId, documentId, ydoc,awareness]);

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
            if (selectionToolbarRef.current?.contains(target)) return;

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

            if (!editorDom.contains(target) && selectionToolbar) {
                setSelectionToolbar(null);
            }
        }

        document.addEventListener('mousedown', handleMouseDownCapture, true);
        return () => document.removeEventListener('mousedown', handleMouseDownCapture, true);
    }, [editor, selectedImage, clearImageSelection, selectionToolbar]);

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
        if (!selectionToolbar) {
            setFormError('Select some text first.');
            return;
        }
        const { from, to, text } = selectionToolbar;
        setFormError(null);
        setSelectionToolbar(null);

        const tabId = crypto.randomUUID();
        const label = TEXT_ACTIONS.find((a) => a.action === action)?.label ?? action;
        const color = TAB_COLORS[tabColorCounterRef.current % TAB_COLORS.length];
        tabColorCounterRef.current += 1;

        setTabs((prev) => [
            { id: tabId, kind: 'text', label, action, status: 'loading', result: null, error: null, sourceText: text, fromPos: from, toPos: to, color },
            ...prev,
        ]);

        try {
            const response = await apiClient.post<{ action: string; result: string }>(
                `/api/workspaces/${workspaceId}/documents/${documentId}/ai/text`,
                { action, text }
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
        setTabs((prev) => [{ id: tabId, kind: 'image', label, action, status: 'loading', result: null, error: null }, ...prev]);

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

    // Re-runs the same action against the same source text, updating the
    // existing card in place (id unchanged) — its position and color stay
    // put. Text tabs only: image regenerate wasn't asked for.
    async function handleRegenerate(tab: AiResultTab) {
        if (tab.kind !== 'text' || !tab.sourceText) return;
        const action = tab.action as TextAction;
        setTabs((prev) => prev.map((t) => (t.id === tab.id ? { ...t, status: 'loading', result: null, error: null, inserted: false } : t)));
        try {
            const response = await apiClient.post<{ action: string; result: string }>(
                `/api/workspaces/${workspaceId}/documents/${documentId}/ai/text`,
                { action, text: tab.sourceText }
            );
            setTabs((prev) => prev.map((t) => (t.id === tab.id ? { ...t, status: 'done', result: response.result } : t)));
        } catch (err) {
            const message = extractErrorMessage(err);
            setTabs((prev) => prev.map((t) => (t.id === tab.id ? { ...t, status: 'error', error: message } : t)));
        }
    }

    function closeTab(id: string) {
        setTabs((prev) => prev.filter((t) => t.id !== id));
    }
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

    function jumpToSource(tab: AiResultTab) {
        if (!editor || editor.isDestroyed || tab.fromPos == null || tab.toPos == null) return;
        editor.chain().focus().setTextSelection({ from: tab.fromPos, to: tab.toPos }).scrollIntoView().run();
        const collapseTo = tab.toPos;
        window.setTimeout(() => {
            if (editor && !editor.isDestroyed) editor.commands.setTextSelection(collapseTo);
        }, 1400);
    }

    function insertResultIntoDoc(tab: AiResultTab) {
        if (!editor || editor.isDestroyed || !tab.result || tab.toPos == null || !canEdit) return;
        editor
            .chain()
            .focus()
            .insertContentAt(tab.toPos, {
                type: 'paragraph',
                content: [
                    { type: 'text', marks: [{ type: 'bold' }, { type: 'italic' }], text: `✦ AI · ${tab.label} — ` },
                    { type: 'text', text: tab.result },
                ],
            })
            .run();
        setTabs((prev) => prev.map((t) => (t.id === tab.id ? { ...t, inserted: true } : t)));
    }

    useEffect(() => {
        return () => {
            if (titleDebounceRef.current) clearTimeout(titleDebounceRef.current);
        };
    }, []);

    if (loading) return <p style={{ padding: "1.4rem" }}>Loading document...</p>;

    return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>

        <div className="topbar">
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", flex: 1, minWidth: 0 }}>
                <div className="breadcrumb">
                    <Link href={`/workspaces/${workspaceId}${folderId ? `?folderId=${folderId}` : ""}`} className="breadcrumb-link">
                        Workspace
                    </Link>
                    <span className="breadcrumb-sep">›</span>
                    <span className="breadcrumb-current">{title || "Untitled"}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                    <input
                        type="text"
                        className="doc-title-input"
                        value={title}
                        onChange={handleTitleChange}
                        placeholder="Untitled"
                    />
                    <button onClick={handleManualSave} disabled={titleStatus === "saving"} className="btn-secondary">
                        {titleStatus === "saving" ? "Saving…" : "Save"}
                    </button>
                    {titleStatus === "saved" && <span className="muted" style={{ fontSize: 11 }}>Saved</span>}
                    {titleStatus === "error" && <span className="error-text" style={{ fontSize: 11 }}>Failed to save</span>}
                    {!aiPanelOpen && (
                        <button className="btn-secondary" onClick={() => setAiPanelOpen(true)}>
                            AI Results{tabs.length > 0 ? ` (${tabs.length})` : ''}
                        </button>
                    )}
                </div>
            </div>

            {onlineUsers.length > 0 && (
                <div className="avatar-stack">
                    <span className="avatar-circle" style={{ background: colorForUser(user?.id) }} title="You">
                        {initialsFor(user?.displayName || user?.email || "You")}
                    </span>
                    {onlineUsers.map((u) => (
                        <span key={u.clientId} className="avatar-circle" style={{ background: u.color }} title={u.name}>
                            {initialsFor(u.name)}
                        </span>
                    ))}
                </div>
            )}
        </div>

        <div className="presence-bar">
            <span className={`status-dot ${connectionStatus}`} />
            {connectionStatus === "connecting" && "Connecting…"}
            {connectionStatus === "disconnected" && (
                <span className="error-text">Disconnected — refresh the page to reconnect</span>
            )}
            {connectionStatus === "connected" && (
                onlineUsers.length === 0
                    ? "Only you're editing this doc"
                    : `${onlineUsers.map((u) => u.name).join(" and ")} ${onlineUsers.length === 1 ? "is" : "are"} editing this doc with you`
            )}
        </div>

        {error && <p className="error-text" style={{ padding: "0.5rem 1.4rem 0" }}>{error}</p>}

        <div style={{ display: "flex", gap: "1rem", alignItems: "stretch", flex: 1, minHeight: 0, padding: "1rem 1.4rem 1.4rem", boxSizing: "border-box" }}>
            <div ref={editorWrapperRef} style={{ flex: 1, position: "relative", overflowY: "auto" }}>
                <div className="editor-canvas">
                    <EditorContent editor={editor} />
                    {!selectionToolbar && !selectedImage && tabs.length === 0 && (
                        <p className="editor-hint">Select any sentence above to explain, summarize, or quiz yourself on it.</p>
                    )}
                </div>

                {tabs.map((tab) => (
                    tab.kind === 'text' && tab.color && gutterPositions[tab.id] ? (
                        <button
                            key={`gutter-${tab.id}`}
                            className="gutter-tab"
                            style={{ top: gutterPositions[tab.id].top, left: gutterPositions[tab.id].left, background: tab.color }}
                            title={`${tab.label} — click to view result`}
                            onClick={() => { setAiPanelOpen(true); jumpToSource(tab); }}
                        />
                    ) : null
                ))}

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

                        {aiPanelOpen && (
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
                    <div className="ai-panel-header">
                        <div className="section-label" style={{ margin: 0 }}>AI Results</div>
                        <button className="ai-panel-close" onClick={() => setAiPanelOpen(false)} title="Close AI Results panel" aria-label="Close AI Results panel">×</button>
                    </div>

                    {!selectedText.trim() && !selectedImage && tabs.length === 0 && (
                        <div className="ai-empty-state">
                            <div className="ai-empty-icon">❝</div>
                            <p className="ai-empty-text">
                                Select text to bring up AI actions, or click an image for image actions.
                                Results will link back to the exact passage they came from.
                            </p>
                        </div>
                    )}

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
                                className="btn-secondary"
                                style={{ width: "100%" }}
                            >
                                {isUploadingImage ? 'Uploading...' : 'Insert Image'}
                            </button>
                            {uploadError && <p className="error-text">{uploadError}</p>}
                        </div>
                    )}

                    {formError && <p className="error-text">{formError}</p>}

                    {tabs.length > 0 && (
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "1rem" }}>
                            {tabs.map((tab) => (
                                <div
                                    key={tab.id}
                                    className="ai-result-card"
                                    draggable
                                    onDragStart={() => handleTabDragStart(tab.id)}
                                    onDragOver={handleTabDragOver}
                                    onDrop={() => handleTabDrop(tab.id)}
                                >
                                    <div className="ai-result-card-strip" style={{ background: tab.color || 'var(--border-strong)' }} />
                                    <div className="ai-result-card-body">
                                        <div className="ai-result-card-header">
                                            <span className="ai-result-card-label">
                                                {tab.status === 'loading' ? '… ' : tab.status === 'error' ? '⚠ ' : ''}
                                                {tab.label}
                                            </span>
                                            <button
                                                onClick={() => closeTab(tab.id)}
                                                className="ai-panel-close"
                                                title={`Dismiss ${tab.label}`}
                                                aria-label={`Dismiss ${tab.label}`}
                                            >
                                                ×
                                            </button>
                                        </div>

                                        {tab.kind === 'text' && tab.sourceText && (
                                            <button
                                                className="citation-chip"
                                                style={tab.color ? { borderColor: tab.color } : undefined}
                                                onClick={() => jumpToSource(tab)}
                                                title="Jump to the source passage in the document"
                                            >
                                                <span style={{ width: 6, height: 6, borderRadius: 2, background: tab.color, flexShrink: 0, marginTop: 3, display: "inline-block" }} />
                                                <span>
                                                    &ldquo;{tab.sourceText.length > 140 ? `${tab.sourceText.slice(0, 140)}…` : tab.sourceText}&rdquo;
                                                </span>
                                            </button>
                                        )}

                                        {tab.status === 'loading' && <p className="muted">Performing action…</p>}
                                        {tab.status === 'error' && <p className="error-text">{tab.error}</p>}
                                        {tab.status === 'done' && <p style={{ whiteSpace: "pre-wrap" }}>{tab.result}</p>}

                                        {tab.status === 'done' && (
                                            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                                                {tab.kind === 'text' && canEdit && (
                                                    <button
                                                        onClick={() => insertResultIntoDoc(tab)}
                                                        disabled={tab.inserted}
                                                        className="btn-primary"
                                                        style={{ flex: 1 }}
                                                    >
                                                        {tab.inserted ? 'Inserted ✓' : 'Insert into doc'}
                                                    </button>
                                                )}
                                                {tab.kind === 'text' && (
                                                    <button
                                                        onClick={() => handleRegenerate(tab)}
                                                        className="btn-secondary"
                                                        style={{ flex: 1 }}
                                                    >
                                                        Regenerate
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </aside>
            )}
        </div>

        {selectionToolbar && (
            <div
                ref={selectionToolbarRef}
                className="selection-toolbar"
                style={{ top: selectionToolbar.top - 44, left: selectionToolbar.left }}
            >
                {TEXT_ACTIONS.map(({ action, label }) => (
                    <button key={action} onClick={() => handleTextAction(action)} title={label}>
                        {label}
                    </button>
                ))}
            </div>
        )}
    </div>
)};
export default function DocumentEditorPage() {
    return (
        <RequireAuth>
            <DocumentEditorContent />
        </RequireAuth>
    );
}