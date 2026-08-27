"use client";

import { useEffect, useState, SyntheticEvent } from "react";
import { useParams, useSearchParams } from "next/navigation";
import RequireAuth from "@/components/RequireAuth";
import { apiClient, ApiError } from "@/lib/apiClient";
import type { DocumentSummary } from "@/types/document";
import type { Folder } from "@/types/folder";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";

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

interface WorkspaceMemberEntry {
    memberId: string;
    role: "owner" | "editor" | "viewer";
    joinedAt: string;
    user: {
        id: string;
        displayName: string;
        email: string;
        avatarUrl: string | null;
    };
}

interface ArchiveChildren {
    folders: FolderWithParent[];
    documents: DocumentSummary[];
    
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

const ROLE_RANK: Record<"owner" | "editor" | "viewer", number> = { owner: 0, editor: 1, viewer: 2 };
function sortMembers(list: WorkspaceMemberEntry[]): WorkspaceMemberEntry[] {
    return [...list].sort((a, b) => {
        const rankDiff = ROLE_RANK[a.role] - ROLE_RANK[b.role];
        if (rankDiff !== 0) return rankDiff;
        const nameA = a.user.displayName ?? a.user.email;
        const nameB = b.user.displayName ?? b.user.email;
        return nameA.localeCompare(nameB);
    });
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

    // Invite / membership state — this workspace page is the correct home
    // for this (not the document editor page); membership is a
    // workspace-level concept, not a per-document one.
    const [members, setMembers] = useState<WorkspaceMemberEntry[]>([]);
    const [inviteEmail, setInviteEmail] = useState("");
    const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("editor");
    const [inviting, setInviting] = useState(false);
    const [inviteError, setInviteError] = useState<string | null>(null);
    const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);

    const [memberActionPending, setMemberActionPending] = useState<string | null>(null);
    const [memberActionError, setMemberActionError] = useState<string | null>(null);

    const { user, updateDisplayName } = useAuth();
    const [showArchived, setShowArchived] = useState(false);
    const [archivedDocuments, setArchivedDocuments] = useState<DocumentSummary[]>([]);
    const [archivedLoading, setArchivedLoading] = useState(false);
    const [archivedError, setArchivedError] = useState<string | null>(null);
    const [restoringKey, setRestoringKey] = useState<string | null>(null);
    const [archivedFolders, setArchivedFolders] = useState<FolderWithParent[]>([]);   // was Folder[]   

    const router = useRouter();
    const [hardDeleteTarget, setHardDeleteTarget] = useState<{ type: ItemType | "workspace"; id: string; name: string } | null>(null);
    const [hardDeleteConfirmText, setHardDeleteConfirmText] = useState("");
    const [hardDeletePending, setHardDeletePending] = useState(false);
    const [hardDeleteError, setHardDeleteError] = useState<string | null>(null);

    const [workspaceName, setWorkspaceName] = useState("");

    const [editingName, setEditingName] = useState(false);
    const [nameInput, setNameInput] = useState("");
    const [nameSaving, setNameSaving] = useState(false);
    const [nameError, setNameError] = useState<string | null>(null);

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
            apiClient.get<{ members: WorkspaceMemberEntry[] }>(`/api/workspaces/${workspaceId}/members`),
            apiClient.get<{ workspace: { name: string } }>(`/api/workspaces/${workspaceId}`),
        ])
            .then(([folderRes, docRes, trail, memberRes, membersListRes,workspaceRes]) => {
                setMembers(sortMembers(membersListRes.members));
                if (!cancelled) {
                    setFolders(folderRes.folders);
                    setDocuments(docRes.documents);
                    setBreadcrumbs(trail);
                    setWorkspaceRole(memberRes.role);
                    setWorkspaceName(workspaceRes.workspace.name);
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
    // Promotion and demotion both go through this — the backend's
    // updateMemberRole treats role as a plain target value, not a
    // directional action, so 'owner' promotes, anything else demotes.
    async function handleChangeRole(memberId: string, newRole: "owner" | "editor" | "viewer") {
        const target = members.find((m) => m.memberId === memberId);
        if (!target) return;

        // Structural guard: an owner can never change their own role. This is
        // what makes "owner demotes self and gets stuck" impossible, not just
        // discouraged — someone else, still an owner, always has to do it.
        if (target.user.id === user?.id) {
            setMemberActionError("You can't change your own role. Ask another owner to do it.");
            return;
        }

        if (newRole === "owner") {
            const confirmed = window.confirm(
                `Make ${target.user.displayName} an owner? Owners have full control over this workspace, including removing other members.`
            );
            if (!confirmed) return;
        }

        setMemberActionPending(memberId);
        setMemberActionError(null);

        try {
            await apiClient.patch<{ member: WorkspaceMemberEntry }>(
                `/api/workspaces/${workspaceId}/members/${memberId}/role`,
                { role: newRole }
            );
            setMembers((prev) => sortMembers(prev.map((m) => (m.memberId === memberId ? { ...m, role: newRole } : m))));
        } catch (err) {
            setMemberActionError(err instanceof ApiError ? err.message : "Failed to update role.");
        } finally {
            setMemberActionPending(null);
        }
    }

    async function handleRemoveMember(memberId: string, displayName: string) {
        const target = members.find((m) => m.memberId === memberId);
        if (!target) return;

        if (target.user.id === user?.id) {
            setMemberActionError("You can't remove yourself. Use \"Leave workspace\" instead.");
            return;
        }
        if (target.role === "owner") {
            setMemberActionError("Owners can't be removed directly — demote them first.");
            return;
        }

        if (!window.confirm(`Remove ${displayName} from this workspace?`)) return;

        setMemberActionPending(memberId);
        setMemberActionError(null);

        try {
            await apiClient.delete(`/api/workspaces/${workspaceId}/members/${memberId}`);
            setMembers((prev) => prev.filter((m) => m.memberId !== memberId));
        } catch (err) {
            setMemberActionError(err instanceof ApiError ? err.message : "Failed to remove member.");
        } finally {
            setMemberActionPending(null);
        }
    }
    // Owner-only, matching the backend's requireWorkspaceRole('owner') on
    // POST /members/invite exactly — gating client-side too avoids a
    // pointless round-trip to a 403 for editors/viewers.
    async function handleInvite(e: SyntheticEvent<HTMLFormElement>) {
        e.preventDefault();
        setInviting(true);
        setInviteError(null);
        setInviteSuccess(null);

        try {
            const { member } = await apiClient.post<{ member: WorkspaceMemberEntry }>(
                `/api/workspaces/${workspaceId}/members/invite`,
                { email: inviteEmail.trim(), role: inviteRole }
            );
            setMembers((prev) => sortMembers([...prev, member]));
            setInviteSuccess(`${member.user.displayName} added as ${member.role}.`);
            setInviteEmail("");
        } catch (err) {
            // Surfaces the backend's specific error codes (USER_NOT_FOUND,
            // ALREADY_A_MEMBER, INVALID_ROLE) directly via err.message —
            // these are expected, common cases, not generic failures.
            setInviteError(err instanceof ApiError ? err.message : "Failed to send invite.");
        } finally {
            setInviting(false);
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
                ? `Archive "${label}"? All documents and subfolders inside will be archived too.`
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

    async function loadArchivedItems() {
        
        setArchivedLoading(true);
        setArchivedError(null);
        try {
            const { folders: af, documents: ad } = await apiClient.get<{ folders: FolderWithParent[]; documents: DocumentSummary[] }>(`/api/workspaces/${workspaceId}/documents/archived`);
            setArchivedFolders(af);
            setArchivedDocuments(ad);
        } catch (err) {
            setArchivedError(err instanceof ApiError ? err.message : "Failed to load archived items.");
        } finally {
            setArchivedLoading(false);
        }
    }

    function buildArchiveChildren(folders: FolderWithParent[], documents: DocumentSummary[]): Map<string, ArchiveChildren> {
        const folderIds = new Set(folders.map((f) => f.id));
        const map = new Map<string, ArchiveChildren>();
        const ensure = (key: string) => map.get(key) ?? (map.set(key, { folders: [], documents: [] }), map.get(key)!);

        folders.forEach((f) => {
            const parentKey = f.parentFolderId && folderIds.has(f.parentFolderId) ? f.parentFolderId : "root";
            ensure(parentKey).folders.push(f);
        });
        documents.forEach((d) => {
            const parentKey = d.folderId && folderIds.has(d.folderId) ? d.folderId : "root";
            ensure(parentKey).documents.push(d);
        });
        return map;
    }

    function renderArchiveNode(nodeKey: string, childrenMap: Map<string, ArchiveChildren>, depth: number) {
        const node = childrenMap.get(nodeKey);
        if (!node) return null;
        return (
            <>
                {node.folders.map((f) => (
                    <div key={f.id}>
                        <div className="row" style={{ marginLeft: depth * 20 }}>
                            <span>{f.name} <span className="muted">(folder)</span></span>
                            <span style={{ display: "flex", gap: "0.4rem" }}>
                                <button className="btn-primary" disabled={restoringKey === keyFor("folder", f.id)} onClick={() => handleUnarchiveFolder(f.id, f.name)}>
                                    {restoringKey === keyFor("folder", f.id) ? "Restoring…" : "Restore"}
                                </button>
                                <button className="btn-danger" onClick={() => openHardDeleteConfirm("folder", f.id, f.name)}>
                                    Delete Permanently
                                </button>
                            </span>
                        </div>
                        {renderArchiveNode(f.id, childrenMap, depth + 1)}
                    </div>
                ))}
                
                {node.documents.map((d) => (
                    <div key={d.id} className="row" style={{ marginLeft: depth * 20 }}>
                        <span><Link href={`/workspaces/${workspaceId}/archived/${d.id}`}>{d.title}</Link> <span className="muted">(document)</span></span>
                        <span style={{ display: "flex", gap: "0.4rem" }}>
                            <button className="btn-primary" disabled={restoringKey === keyFor("document", d.id)} onClick={() => handleUnarchiveDocument(d.id, d.title)}>
                                {restoringKey === keyFor("document", d.id) ? "Restoring…" : "Restore"}
                            </button>
                            <button className="btn-danger" onClick={() => openHardDeleteConfirm("document", d.id, d.title)}>
                                Delete Permanently
                            </button>
                        </span>
                    </div>
                ))}
            </>
            
        );
    }

    function toggleArchivedView() {
        const next = !showArchived;
        setShowArchived(next);
        if (next) loadArchivedItems();
    }

    // Restoring can bring an item back into whatever folder/root the user is
    // currently viewing — refetch the active lists so it appears immediately,
    // rather than requiring a manual reload.
    async function refreshActiveView() {
        try {
            const [folderRes, docRes] = await Promise.all([
                apiClient.get<{ folders: Folder[] }>(`/api/workspaces/${workspaceId}/folders?parentId=${activeFolderId ?? "root"}`),
                apiClient.get<{ documents: DocumentSummary[] }>(`/api/workspaces/${workspaceId}/documents?folderId=${activeFolderId ?? "root"}`),
            ]);
            setFolders(folderRes.folders);
            setDocuments(docRes.documents);
        } catch {
            // Non-critical — the archived list itself is already updated below;
            // the active view will just catch up on next natural reload.
        }
    }

    async function handleUnarchiveFolder(folderId: string, name: string) {
        const key = keyFor("folder", folderId);
        setRestoringKey(key);
        setArchivedError(null);
        try {
            await apiClient.patch(`/api/workspaces/${workspaceId}/folders/${folderId}/unarchive`);
            await loadArchivedItems();
            refreshActiveView();
        } catch (err) {
            setArchivedError(err instanceof ApiError ? err.message : `Failed to restore "${name}".`);
        } finally {
            setRestoringKey(null);
        }
    }

    async function handleUnarchiveDocument(documentId: string, title: string) {
        const key = keyFor("document", documentId);
        setRestoringKey(key);
        setArchivedError(null);
        try {
            await apiClient.patch(`/api/workspaces/${workspaceId}/documents/${documentId}/unarchive`);
            setArchivedDocuments((prev) => prev.filter((d) => d.id !== documentId));
            refreshActiveView();
        } catch (err) {
            setArchivedError(err instanceof ApiError ? err.message : `Failed to restore "${title}".`);
        } finally {
            setRestoringKey(null);
        }
    }

    function renderActions(type: ItemType, id: string, label: string) {
        if (!canEdit) return null;
        const key = keyFor(type, id);
        if (renamingKey === key) return null;

        return (
            <span data-kebab-menu style={{ position: "relative", marginLeft: "0.5rem" }}>
                <button onClick={() => toggleMenu(type, id)} style={{ padding: "0.15rem 0.5rem", border: "none" }}>⋮</button>
                {openMenuKey === key && (
                    <div style={{ position: "absolute", top: "1.9rem", right: 0, zIndex: 20, display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius)", minWidth: "140px", overflow: "hidden" }}>
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
                        {workspaceRole === "owner" && (
                            <button
                                className="btn-danger"
                                style={{ border: "none", borderRadius: 0, textAlign: "left" }}
                                onClick={() => openHardDeleteConfirm(type, id, label)}
                            >
                                Delete Permanently
                            </button>
                        )}
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

    function openHardDeleteConfirm(type: ItemType | "workspace", id: string, name: string) {
        setOpenMenuKey(null);
        setHardDeleteTarget({ type, id, name });
        setHardDeleteConfirmText("");
        setHardDeleteError(null);
    }

    function cancelHardDelete() {
        setHardDeleteTarget(null);
        setHardDeleteConfirmText("");
        setHardDeleteError(null);
    }

    // Type-to-confirm rather than a plain confirm() dialog — this is
    // irreversible and cascades (folders/workspace take everything inside
    // them with them), so it deliberately requires more friction than a
    // single click.
    async function confirmHardDelete() {
        if (!hardDeleteTarget || hardDeleteConfirmText !== hardDeleteTarget.name) return;

        setHardDeletePending(true);
        setHardDeleteError(null);

        try {
            if (hardDeleteTarget.type === "folder") {
                await apiClient.delete(`/api/workspaces/${workspaceId}/folders/${hardDeleteTarget.id}/permanent`);
                setFolders((prev) => prev.filter((f) => f.id !== hardDeleteTarget.id));
                setArchivedFolders((prev) => prev.filter((f) => f.id !== hardDeleteTarget.id));
            } else if (hardDeleteTarget.type === "document") {
                await apiClient.delete(`/api/workspaces/${workspaceId}/documents/${hardDeleteTarget.id}/permanent`);
                setDocuments((prev) => prev.filter((d) => d.id !== hardDeleteTarget.id));
                setArchivedDocuments((prev) => prev.filter((d) => d.id !== hardDeleteTarget.id));
            } else {
                await apiClient.delete(`/api/workspaces/${workspaceId}/permanent`);
                router.push("/workspaces");
                return; // workspace itself is gone — nothing left to update locally
            }
            setHardDeleteTarget(null);
        } catch (err) {
            setHardDeleteError(err instanceof ApiError ? err.message : "Failed to permanently delete.");
        } finally {
            setHardDeletePending(false);
        }
    }

    async function handleSaveName() {
        const trimmed = nameInput.trim();
        if (!trimmed) return;

        setNameSaving(true);
        setNameError(null);
        try {
            await updateDisplayName(trimmed);
            // Reflect the new name in the member list too — AuthContext's
            // user object updates automatically, but the rendered row reads
            // from the separately-fetched `members` array, not from `user`.
            setMembers((prev) => sortMembers(prev.map((m) => (m.user.id === user?.id ? { ...m, user: { ...m.user, displayName: trimmed } } : m))));
            setEditingName(false);
        } catch (err) {
            setNameError(err instanceof ApiError ? err.message : "Failed to update name.");
        } finally {
            setNameSaving(false);
        }
    }
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

            <p className="section-label">Members</p>
            {memberActionError && <p className="error-text">{memberActionError}</p>}
            <div style={{ marginBottom: "0.75rem" }}>
                {members.map((m) => {
                    const isSelf = m.user.id === user?.id;
                    return (
                        <div key={m.memberId} className="row">
                            {isSelf && editingName ? (
                                <span style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                                    <input
                                        type="text"
                                        value={nameInput}
                                        onChange={(e) => setNameInput(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") handleSaveName();
                                            if (e.key === "Escape") setEditingName(false);
                                        }}
                                        autoFocus
                                        style={{ fontSize: "14px" }}
                                    />
                                    <button className="btn-primary" disabled={nameSaving} onClick={handleSaveName}>
                                        {nameSaving ? "Saving…" : "Save"}
                                    </button>
                                    <button onClick={() => setEditingName(false)} disabled={nameSaving}>Cancel</button>
                                </span>
                            ): (
                                <span>
                                    {m.user.displayName} <span className="muted">({m.user.email})</span>
                                    {isSelf && (
                                        <>
                                            <span className="muted"> — you</span>{" "}
                                            <button
                                                onClick={() => {
                                                    setNameInput(m.user.displayName ?? "");
                                                    setEditingName(true);
                                                    setNameError(null);
                                                }}
                                                style={{ fontSize: "11px", padding: "1px 6px", border: "none" }}
                                            >
                                                edit
                                            </button>
                                        </>
                                    )}
                                </span>
                            )}
                            <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                {workspaceRole === "owner" && !isSelf ? (
                                    <select
                                        value={m.role}
                                        disabled={memberActionPending === m.memberId}
                                        onChange={(e) =>
                                            handleChangeRole(m.memberId, e.target.value as "owner" | "editor" | "viewer")
                                        }
                                        style={{
                                            background: "var(--surface)",
                                            color: "var(--text)",
                                            border: "1px solid var(--border-strong)",
                                            borderRadius: "4px",
                                            padding: "0.25rem 0.4rem",
                                            fontSize: "13px",
                                        }}
                                    >
                                        <option value="owner">Owner</option>
                                        <option value="editor">Editor</option>
                                        <option value="viewer">Viewer</option>
                                    </select>
                                ) : (
                                    <span className="muted">{m.role}</span>
                                )}
                                {workspaceRole === "owner" && !isSelf && m.role !== "owner" && (
                                    <button
                                        className="btn-danger"
                                        disabled={memberActionPending === m.memberId}
                                        onClick={() => handleRemoveMember(m.memberId, m.user.displayName)}
                                    >
                                        {memberActionPending === m.memberId ? "…" : "Remove"}
                                    </button>
                                )}
                            </span>
                        </div>
                    );
                })}
            </div>
            {nameError && <p className="error-text">{nameError}</p>}

            {workspaceRole === "owner" && (
                <form onSubmit={handleInvite} style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem" }}>
                    <input
                        type="email"
                        placeholder="Invite by email"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        style={{ flex: 1 }}
                        required
                    />
                    <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as "editor" | "viewer")}>
                        <option value="editor">Editor</option>
                        <option value="viewer">Viewer</option>
                    </select>
                    <button type="submit" className="btn-primary" disabled={inviting}>
                        {inviting ? "Inviting…" : "Invite"}
                    </button>
                </form>
            )}
            {inviteError && <p className="error-text">{inviteError}</p>}
            {inviteSuccess && <p className="muted">{inviteSuccess}</p>}

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
            {workspaceRole === "owner" && (
                <>
                    <button onClick={toggleArchivedView} style={{ marginBottom: "0.75rem" }}>
                        {showArchived ? "Hide archived items" : "View archived items"}
                    </button>

                    {showArchived && (
                        <div style={{ marginBottom: "1.5rem", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "1rem" }}>
                            <p className="section-label" style={{ marginTop: 0 }}>Archived</p>
                            {archivedError && <p className="error-text">{archivedError}</p>}
                            {archivedLoading ? (
                                <p className="muted">Loading archived items…</p>
                            ) : archivedFolders.length === 0 && archivedDocuments.length === 0 ? (
                                <p className="muted">Nothing archived.</p>
                            ) : (
                                <>
                                    {renderArchiveNode("root", buildArchiveChildren(archivedFolders, archivedDocuments), 0)}                                </>
                            )}
                        </div>
                    )}
                </>
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

            {workspaceRole === "owner" && (
                <div style={{ marginTop: "3rem", padding: "1rem", border: "1px solid var(--border-strong)", borderRadius: "var(--radius)" }}>
                    <p className="section-label" style={{ color: "var(--danger)" }}>Danger Zone</p>
                    <p className="muted" style={{ fontSize: "13px" }}>
                        Permanently delete this entire workspace, including all folders, documents, and members. This cannot be undone.
                    </p>
                    <button
                        className="btn-danger"
                        onClick={() => openHardDeleteConfirm("workspace", workspaceId, workspaceName)}
                    >
                        Delete Workspace Permanently
                    </button>
                </div>
            )}

            {hardDeleteTarget && (
                <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
                    <div style={{ background: "var(--surface)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius)", padding: "1.5rem", maxWidth: "420px", width: "90%" }}>
                        <h3 style={{ marginTop: 0 }}>Permanently delete {hardDeleteTarget.type}?</h3>
                        <p className="muted">
                            This cannot be undone.
                            {hardDeleteTarget.type === "folder" && " All documents and subfolders inside will also be permanently deleted."}
                            {hardDeleteTarget.type === "workspace" && " Every folder, document, and member in this workspace will be permanently deleted."}
                        </p>
                        <p>
                            Type <strong>{hardDeleteTarget.name}</strong> to confirm:
                        </p>
                        <input
                            type="text"
                            value={hardDeleteConfirmText}
                            onChange={(e) => setHardDeleteConfirmText(e.target.value)}
                            style={{ width: "100%", marginBottom: "0.75rem" }}
                            autoFocus
                        />
                        {hardDeleteError && <p className="error-text">{hardDeleteError}</p>}
                        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                            <button onClick={cancelHardDelete} disabled={hardDeletePending}>Cancel</button>
                            <button
                                className="btn-danger"
                                disabled={hardDeleteConfirmText !== hardDeleteTarget.name || hardDeletePending}
                                onClick={confirmHardDelete}
                            >
                                {hardDeletePending ? "Deleting…" : "Delete Permanently"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
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