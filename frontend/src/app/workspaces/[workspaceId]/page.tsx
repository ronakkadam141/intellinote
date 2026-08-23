"use client";

import { useEffect, useState, SyntheticEvent } from "react";
import { useParams, useSearchParams } from "next/navigation";
import RequireAuth from "@/components/RequireAuth";
import { apiClient, ApiError } from "@/lib/apiClient";
import type { DocumentSummary } from "@/types/document";
import type { Folder } from "@/types/folder";
import Link from "next/link";

interface Crumb {
    id: string;
    name: string;
}

interface FolderWithParent extends Folder {
    parentFolderId: string | null;
}

interface FolderTreeNode {
    id: string;
    name: string;
    parentFolderId: string | null;
    depth: number;
}

type ItemType = "folder" | "document";

function keyFor(type: ItemType, id: string) {
    return `${type}:${id}`;
}

async function fetchAllFoldersFlat(workspaceId: string): Promise<FolderTreeNode[]> {
    const result: FolderTreeNode[] = [];

    async function recurse(parentId: string | null, depth: number) {
        const { folders } = await apiClient.get<{
            folders: { id: string; name: string; parentFolderId: string | null }[];
        }>(`/api/workspaces/${workspaceId}/folders?parentId=${parentId ?? "root"}`);

        for (const f of folders) {
            result.push({ id: f.id, name: f.name, parentFolderId: f.parentFolderId, depth });
            await recurse(f.id, depth + 1);
        }
    }

    await recurse(null, 0);
    return result;
}

function getDescendantIds(tree: FolderTreeNode[], rootId: string): string[] {
    const children = tree.filter((f) => f.parentFolderId === rootId).map((f) => f.id);
    return children.reduce<string[]>((acc, cid) => [...acc, cid, ...getDescendantIds(tree, cid)], []);
}

function WorkspaceHomeContent() {
    const { workspaceId } = useParams<{ workspaceId: string }>();
    const searchParams = useSearchParams();
    const activeFolderId = searchParams.get("folderId");
    const [folders, setFolders] = useState<Folder[]>([]);
    const [documents, setDocuments] = useState<DocumentSummary[]>([]);
    const [breadcrumbs, setBreadcrumbs] = useState<Crumb[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [newFolderName, setNewFolderName] = useState("");
    const [newDocTitle, setNewDocTitle] = useState("");
    const [creatingFolder, setCreatingFolder] = useState(false);
    const [creatingDoc, setCreatingDoc] = useState(false);

    const [workspaceRole, setWorkspaceRole] = useState<"owner" | "editor" | "viewer" | null>(null);
    const canEdit = workspaceRole === "owner" || workspaceRole === "editor";

    const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);
    const [renamingKey, setRenamingKey] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState("");
    const [movingKey, setMovingKey] = useState<string | null>(null);
    const [moveOptions, setMoveOptions] = useState<FolderTreeNode[] | null>(null);
    const [moveLoading, setMoveLoading] = useState(false);
    const [moveTarget, setMoveTarget] = useState<string>("");
    const [actionPending, setActionPending] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        async function loadBreadcrumbs(): Promise<Crumb[]> {
            if (!activeFolderId) return [] as Crumb[];
            const trail: Crumb[] = [];
            let currentId: string | null = activeFolderId;

            while (currentId) {
                const response: { folder: FolderWithParent } = await apiClient.get<{ folder: FolderWithParent }>(
                    `/api/workspaces/${workspaceId}/folders/${currentId}`
                );
                const folder: FolderWithParent = response.folder;
                trail.unshift({ id: folder.id, name: folder.name });
                currentId = folder.parentFolderId;
            }
            return trail;
        }

        Promise.all([
            apiClient.get<{ folders: Folder[] }>(`/api/workspaces/${workspaceId}/folders?parentId=${activeFolderId ?? "root"}`),
            apiClient.get<{ documents: DocumentSummary[] }>(`/api/workspaces/${workspaceId}/documents?folderId=${activeFolderId ?? "root"}`),
            loadBreadcrumbs(),
            apiClient.get<{ role: "owner" | "editor" | "viewer" }>(`/api/workspaces/${workspaceId}/members/me`),
        ])
            .then(([folderRes, docRes, trail, memberRes]) => {
                if (!cancelled) {
                    setFolders(folderRes.folders);
                    setDocuments(docRes.documents);
                    setBreadcrumbs(trail);
                    setWorkspaceRole(memberRes.role);
                }
            })
            .catch((err) => {
                if (!cancelled) {
                    setError(err instanceof ApiError ? err.message : "Failed to load workspace.");
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [workspaceId, activeFolderId]);

    useEffect(() => {
        function handleDocMouseDown(e: MouseEvent) {
            if (!openMenuKey) return;
            const target = e.target as HTMLElement;
            if (!target.closest("[data-kebab-menu]")) {
                setOpenMenuKey(null);
            }
        }
        document.addEventListener("mousedown", handleDocMouseDown);
        return () => document.removeEventListener("mousedown", handleDocMouseDown);
    }, [openMenuKey]);

    async function handleCreateFolder(e: SyntheticEvent<HTMLFormElement>) {
        e.preventDefault();
        setCreatingFolder(true);
        setError(null);

        try {
            const { folder } = await apiClient.post<{ folder: Folder }>(`/api/workspaces/${workspaceId}/folders`, {
                name: newFolderName,
                parentFolderId: activeFolderId ?? null,
            });

            setFolders((prev) => [...prev, folder]);
            setNewFolderName("");
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Failed to create folder.");
        } finally {
            setCreatingFolder(false);
        }
    }

    async function handleCreateDocument(e: SyntheticEvent<HTMLFormElement>) {
        e.preventDefault();
        setCreatingDoc(true);
        setError(null);

        try {
            const { document } = await apiClient.post<{ document: DocumentSummary }>(`/api/workspaces/${workspaceId}/documents`, {
                title: newDocTitle,
                folderId: activeFolderId ?? null,
            });

            setDocuments((prev) => [...prev, document]);
            setNewDocTitle("");
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Failed to create document.");
        } finally {
            setCreatingDoc(false);
        }
    }

    function toggleMenu(type: ItemType, id: string) {
        const k = keyFor(type, id);
        setOpenMenuKey((prev) => (prev === k ? null : k));
        setRenamingKey(null);
        setMovingKey(null);
        setMoveOptions(null);
    }

    function startRename(type: ItemType, id: string, currentValue: string) {
        setRenamingKey(keyFor(type, id));
        setRenameValue(currentValue);
        setOpenMenuKey(null);
    }

    async function confirmRename(type: ItemType, id: string) {
        const trimmed = renameValue.trim();
        setRenamingKey(null);
        if (!trimmed) return;

        setError(null);
        try {
            if (type === "folder") {
                await apiClient.patch(`/api/workspaces/${workspaceId}/folders/${id}`, { name: trimmed });
                setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name: trimmed } : f)));
            } else {
                await apiClient.patch(`/api/workspaces/${workspaceId}/documents/${id}`, { title: trimmed });
                setDocuments((prev) => prev.map((d) => (d.id === id ? { ...d, title: trimmed } : d)));
            }
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Rename failed.");
        }
    }

    async function openMovePicker(type: ItemType, id: string) {
        const k = keyFor(type, id);
        setMovingKey(k);
        setOpenMenuKey(null);
        setMoveTarget("");
        setMoveLoading(true);
        setMoveOptions(null);
        setError(null);

        try {
            const tree = await fetchAllFoldersFlat(workspaceId);
            if (type === "folder") {
                const excluded = new Set<string>([id, ...getDescendantIds(tree, id)]);
                setMoveOptions(tree.filter((f) => !excluded.has(f.id)));
            } else {
                setMoveOptions(tree);
            }
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Failed to load folders.");
            setMovingKey(null);
        } finally {
            setMoveLoading(false);
        }
    }

    async function confirmMove(type: ItemType, id: string) {
        setError(null);
        const targetId = moveTarget || null;

        try {
            if (type === "folder") {
                await apiClient.patch(`/api/workspaces/${workspaceId}/folders/${id}`, { parentFolderId: targetId });
                if (targetId !== (activeFolderId ?? null)) {
                    setFolders((prev) => prev.filter((f) => f.id !== id));
                }
            } else {
                await apiClient.patch(`/api/workspaces/${workspaceId}/documents/${id}`, { folderId: targetId });
                if (targetId !== (activeFolderId ?? null)) {
                    setDocuments((prev) => prev.filter((d) => d.id !== id));
                }
            }
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Move failed.");
        } finally {
            setMovingKey(null);
            setMoveOptions(null);
        }
    }

    async function handleArchive(type: ItemType, id: string, label: string) {
        setOpenMenuKey(null);
        const confirmMsg =
            type === "folder"
                ? `Archive "${label}"? Subfolders will be archived too; documents inside will be moved to workspace root.`
                : `Archive "${label}"?`;
        if (!window.confirm(confirmMsg)) return;

        const k = keyFor(type, id);
        setActionPending(k);
        setError(null);

        try {
            if (type === "folder") {
                await apiClient.delete(`/api/workspaces/${workspaceId}/folders/${id}`);
                setFolders((prev) => prev.filter((f) => f.id !== id));
            } else {
                await apiClient.delete(`/api/workspaces/${workspaceId}/documents/${id}`);
                setDocuments((prev) => prev.filter((d) => d.id !== id));
            }
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Archive failed.");
        } finally {
            setActionPending(null);
        }
    }

    function renderNameOrInput(type: ItemType, id: string, label: string, href: string) {
        const key = keyFor(type, id);
        if (renamingKey === key) {
            return (
                <input
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") confirmRename(type, id);
                        if (e.key === "Escape") setRenamingKey(null);
                    }}
                    onBlur={() => confirmRename(type, id)}
                    autoFocus
                />
            );
        }
        return <a href={href}>{label}</a>;
    }

    function renderActions(type: ItemType, id: string, label: string) {
        if (!canEdit) return null;
        const key = keyFor(type, id);
        if (renamingKey === key) return null;

        return (
            <span data-kebab-menu style={{ position: "relative", marginLeft: "0.5rem" }}>
                <button onClick={() => toggleMenu(type, id)} style={{ padding: "0.15rem 0.5rem", border: "none" }}>⋮</button>
                {openMenuKey === key && (
                    <div style={{ position: "absolute", top: "1.9rem", right: 0, zIndex: 20, display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius)", minWidth: "120px", overflow: "hidden" }}>
                        <button style={{ border: "none", borderRadius: 0, textAlign: "left" }} onClick={() => startRename(type, id, label)}>Rename</button>
                        <button style={{ border: "none", borderRadius: 0, textAlign: "left" }} onClick={() => openMovePicker(type, id)}>Move</button>
                        <button
                            className="btn-danger"
                            style={{ border: "none", borderRadius: 0, textAlign: "left" }}
                            onClick={() => handleArchive(type, id, label)}
                            disabled={actionPending === key}
                        >
                            {actionPending === key ? "Archiving…" : "Archive"}
                        </button>
                    </div>
                )}
            </span>
        );
    }

    function renderMovePicker(type: ItemType, id: string) {
        const key = keyFor(type, id);
        if (movingKey !== key) return null;

        return (
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginLeft: "0.5rem" }}>
                {moveLoading || !moveOptions ? (
                    <span className="muted">Loading folders…</span>
                ) : (
                    <>
                        <select value={moveTarget} onChange={(e) => setMoveTarget(e.target.value)}>
                            <option value="">Root (no folder)</option>
                            {moveOptions.map((opt) => (
                                <option key={opt.id} value={opt.id}>
                                    {"—".repeat(opt.depth)} {opt.name}
                                </option>
                            ))}
                        </select>
                        <button className="btn-primary" onClick={() => confirmMove(type, id)}>Confirm</button>
                        <button
                            onClick={() => {
                                setMovingKey(null);
                                setMoveOptions(null);
                            }}
                        >
                            Cancel
                        </button>
                    </>
                )}
            </div>
        );
    }

    if (loading) return <p className="muted">Loading workspace…</p>;

    return (
        <div style={{ maxWidth: "680px", margin: "0 auto", padding: "3.5rem 1.5rem" }}>
            <p className="muted" style={{ marginBottom: "0.5rem" }}>
                <Link href="/workspaces">← All workspaces</Link>
            </p>

            <h1>Workspace</h1>
            {error && <p className="error-text">{error}</p>}

            {activeFolderId && (
                <p className="muted" style={{ marginTop: "0.5rem" }}>
                    <a href={`/workspaces/${workspaceId}`}>Root</a>
                    {breadcrumbs.map((crumb, index) => {
                        const isCurrent = index === breadcrumbs.length - 1;
                        return (
                            <span key={crumb.id}>
                                {" "}/{" "}
                                {isCurrent ? crumb.name : <a href={`/workspaces/${workspaceId}?folderId=${crumb.id}`}>{crumb.name}</a>}
                            </span>
                        );
                    })}
                </p>
            )}

            <p className="section-label">Folders</p>
            {folders.length === 0 ? (
                <div className="callout">
                    <p style={{ margin: "0 0 0.25rem", fontFamily: "var(--font-display)", fontSize: "15px" }}>No folders here yet</p>
                    <p className="muted" style={{ margin: 0 }}>
                        Folders keep related documents organized — create one below to get started.
                    </p>
                </div>
            ) : (
                <div>
                    {folders.map((f) => (
                        <div key={f.id} className="row">
                            <span style={{ display: "flex", alignItems: "center" }}>
                                {renderNameOrInput("folder", f.id, f.name, `/workspaces/${workspaceId}?folderId=${f.id}`)}
                            </span>
                            <span style={{ display: "flex", alignItems: "center" }}>
                                {renderMovePicker("folder", f.id)}
                                {renderActions("folder", f.id, f.name)}
                            </span>
                        </div>
                    ))}
                </div>
            )}
            <form onSubmit={handleCreateFolder} style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
                <input
                    type="text"
                    placeholder="New folder name"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    style={{ flex: 1 }}
                    required
                />
                <button type="submit" className="btn-primary" disabled={creatingFolder}>
                    {creatingFolder ? "Creating…" : "Create folder"}
                </button>
            </form>

            <p className="section-label">Documents</p>
            {documents.length === 0 ? (
                <div className="callout">
                    <p style={{ margin: "0 0 0.25rem", fontFamily: "var(--font-display)", fontSize: "15px" }}>No documents here yet</p>
                    <p className="muted" style={{ margin: 0 }}>
                        This is where your notes live — create your first document below.
                    </p>
                </div>
            ) : (
                <div>
                    {documents.map((d) => (
                        <div key={d.id} className="row">
                            <span style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                                {renderNameOrInput("document", d.id, d.title, `/workspaces/${workspaceId}/documents/${d.id}`)}
                                {d.isPinned && <span className="muted" style={{ fontSize: "11px" }}>pinned</span>}
                            </span>
                            <span style={{ display: "flex", alignItems: "center" }}>
                                {renderMovePicker("document", d.id)}
                                {renderActions("document", d.id, d.title)}
                            </span>
                        </div>
                    ))}
                </div>
            )}

            <form onSubmit={handleCreateDocument} style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
                <input
                    type="text"
                    placeholder="New document title"
                    value={newDocTitle}
                    onChange={(e) => setNewDocTitle(e.target.value)}
                    style={{ flex: 1 }}
                    required
                />
                <button type="submit" className="btn-primary" disabled={creatingDoc}>
                    {creatingDoc ? "Creating…" : "Create document"}
                </button>
            </form>
        </div>
    );
}

export default function WorkspaceHomePage() {
    return (
        <RequireAuth>
            <WorkspaceHomeContent />
        </RequireAuth>
    );
}