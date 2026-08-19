"use client";

import { useEffect, useState, SyntheticEvent } from "react";
import { useParams, useSearchParams } from "next/navigation";
import RequireAuth from "@/components/RequireAuth";
import { apiClient, ApiError } from "@/lib/apiClient";
import type { DocumentSummary } from "@/types/document";
import type { Folder } from "@/types/folder";

interface Crumb {
    id: string;
    name: string;
}

interface FolderWithParent extends Folder {
    parentFolderId: string | null;
}

// Local, self-contained shape for the "Move to..." picker — deliberately not
// tied to the imported Folder type, since we only need these three fields
// plus a computed depth for indentation.
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

// Recursively walks GET /folders (which only returns one level at a time)
// to build a full flat list of every folder in the workspace, indented by
// depth. Only called on-demand when a Move picker is opened — not on page
// load — since most page loads never need the whole tree.
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

// Given the full flat tree, returns every descendant id of rootId — used to
// stop a folder from being offered as a move-target for itself or its own
// subtree (the backend already rejects this; this just keeps the dropdown
// from offering an option that would fail).
function getDescendantIds(tree: FolderTreeNode[], rootId: string): string[] {
    const children = tree.filter((f) => f.parentFolderId === rootId).map((f) => f.id);
    return children.reduce<string[]>((acc, cid) => [...acc, cid, ...getDescendantIds(tree, cid)], []);
}

// Minimal shared styling — same rationale as the document editor page:
// Tailwind preflight strips native button chrome, so bare <button> elements
// render as invisible text without this.
const kebabButtonStyle: React.CSSProperties = {
    border: "1px solid #444",
    borderRadius: "4px",
    background: "#1f1f1f",
    color: "inherit",
    cursor: "pointer",
    padding: "0.1rem 0.5rem",
};

const menuStyle: React.CSSProperties = {
    position: "absolute",
    top: "1.6rem",
    left: 0,
    zIndex: 20,
    display: "flex",
    flexDirection: "column",
    background: "#111",
    border: "1px solid #444",
    borderRadius: "4px",
    minWidth: "110px",
};

const menuItemStyle: React.CSSProperties = {
    border: "none",
    background: "transparent",
    color: "inherit",
    textAlign: "left",
    padding: "0.4rem 0.6rem",
    cursor: "pointer",
};

const movePickerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
    marginLeft: "0.5rem",
};

const smallButtonStyle: React.CSSProperties = {
    border: "1px solid #444",
    borderRadius: "4px",
    background: "#1f1f1f",
    color: "inherit",
    cursor: "pointer",
    padding: "0.15rem 0.5rem",
    fontSize: "0.85rem",
};

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

    // Role gating — same pattern as the document editor page. Rename/Move/
    // Archive are only offered to editors/owners; the backend's
    // requireWorkspaceRole('editor') remains the real enforcement layer.
    const [workspaceRole, setWorkspaceRole] = useState<"owner" | "editor" | "viewer" | null>(null);
    const canEdit = workspaceRole === "owner" || workspaceRole === "editor";

    // Kebab menu / rename / move state. Keyed by `${type}:${id}` so folders
    // and documents share one set of state without id collisions.
    const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);
    const [renamingKey, setRenamingKey] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState("");
    const [movingKey, setMovingKey] = useState<string | null>(null);
    const [moveOptions, setMoveOptions] = useState<FolderTreeNode[] | null>(null);
    const [moveLoading, setMoveLoading] = useState(false);
    const [moveTarget, setMoveTarget] = useState<string>(""); // "" = workspace root
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

    // Closes the open kebab menu on any click outside it. Uses a data
    // attribute + closest() instead of per-row refs — simplest option given
    // menus are rendered dynamically per list item.
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

    function renderNameOrInput(type: ItemType, id: string, label: string, href: string, icon: string) {
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
                    style={{ padding: "0.2rem 0.4rem" }}
                />
            );
        }
        return <a href={href}>{icon} {label}</a>;
    }

    function renderActions(type: ItemType, id: string, label: string) {
        if (!canEdit) return null;
        const key = keyFor(type, id);
        if (renamingKey === key) return null;

        return (
            <span data-kebab-menu style={{ position: "relative", marginLeft: "0.5rem" }}>
                <button onClick={() => toggleMenu(type, id)} style={kebabButtonStyle}>⋮</button>
                {openMenuKey === key && (
                    <div style={menuStyle}>
                        <button style={menuItemStyle} onClick={() => startRename(type, id, label)}>Rename</button>
                        <button style={menuItemStyle} onClick={() => openMovePicker(type, id)}>Move</button>
                        <button
                            style={menuItemStyle}
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
            <div style={movePickerStyle}>
                {moveLoading || !moveOptions ? (
                    <span style={{ fontSize: "0.85rem", color: "#666" }}>Loading folders…</span>
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
                        <button onClick={() => confirmMove(type, id)} style={smallButtonStyle}>Confirm</button>
                        <button
                            onClick={() => {
                                setMovingKey(null);
                                setMoveOptions(null);
                            }}
                            style={smallButtonStyle}
                        >
                            Cancel
                        </button>
                    </>
                )}
            </div>
        );
    }

    if (loading) return <p>Loading workspace...</p>;

    return (
        <div>
            <h1>Workspace</h1>
            {error && <p style={{ color: "red" }}>{error}</p>}

            <h2>Folders</h2>
            {folders.length === 0 ? (
                <p>No folders yet.</p>
            ) : (
                <ul>
                    {folders.map((f) => (
                        <li key={f.id} style={{ display: "flex", alignItems: "center", marginBottom: "0.25rem" }}>
                            {renderNameOrInput("folder", f.id, f.name, `/workspaces/${workspaceId}?folderId=${f.id}`, "📁")}
                            {renderActions("folder", f.id, f.name)}
                            {renderMovePicker("folder", f.id)}
                        </li>
                    ))}
                </ul>
            )}
            <form onSubmit={handleCreateFolder}>
                <input
                    type="text"
                    placeholder="New Folder Name"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    required
                />
                <button type="submit" disabled={creatingFolder}>
                    {creatingFolder ? "Creating..." : "Create Folder"}
                </button>
            </form>

            {activeFolderId && (
                <p>
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
            <h2>Documents</h2>
            {documents.length === 0 ? (
                <p>No documents at root level yet.</p>
            ) : (
                <ul>
                    {documents.map((d) => (
                        <li key={d.id} style={{ display: "flex", alignItems: "center", marginBottom: "0.25rem" }}>
                            {renderNameOrInput("document", d.id, d.title, `/workspaces/${workspaceId}/documents/${d.id}`, "📄")}
                            {" "}{d.isPinned && "📌"}
                            {renderActions("document", d.id, d.title)}
                            {renderMovePicker("document", d.id)}
                        </li>
                    ))}
                </ul>
            )}

            <form onSubmit={handleCreateDocument}>
                <input
                    type="text"
                    placeholder="New doument title"
                    value={newDocTitle}
                    onChange={(e) => setNewDocTitle(e.target.value)}
                    required
                />
                <button type="submit" disabled={creatingDoc}>{creatingDoc ? "Creating..." : "Create document"}</button>
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