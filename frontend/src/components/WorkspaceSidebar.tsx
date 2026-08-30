"use client";

import { useCallback, useEffect, useRef, useState, FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiClient } from "@/lib/apiClient";
import SparkleIcon from "@/components/icons/SparkleIcon";
interface FolderNode {
    id: string;
    name: string;
    parentFolderId: string | null;
}
interface DocNode {
    id: string;
    title: string;
    folderId: string | null;
}

function SearchIcon() {
    return (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="7" cy="7" r="4.5" />
            <line x1="10.5" y1="10.5" x2="14" y2="14" />
        </svg>
    );
}

function FolderIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" style={{ flexShrink: 0 }}>
            <path d="M2 4.3C2 3.6 2.6 3 3.3 3H6.3L7.6 4.5H12.7C13.4 4.5 14 5.1 14 5.8V11.2C14 11.9 13.4 12.5 12.7 12.5H3.3C2.6 12.5 2 11.9 2 11.2V4.3Z" />
        </svg>
    );
}

function DocIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" style={{ flexShrink: 0 }}>
            <path d="M4 2.5H9.3L12 5.2V13.5H4V2.5Z" />
            <path d="M9.1 2.5V5.2H11.8" />
        </svg>
    );
}

export default function WorkspaceSidebar({ workspaceId }: { workspaceId: string }) {
    const params = useParams<{ documentId?: string }>();
    const activeDocumentId = params?.documentId;

    const [workspaceName, setWorkspaceName] = useState<string | null>(null);
    const [memberCount, setMemberCount] = useState<number | null>(null);

    const [foldersByParent, setFoldersByParent] = useState<Record<string, FolderNode[]>>({});
    const [docsByParent, setDocsByParent] = useState<Record<string, DocNode[]>>({});
    const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
    const [loadingKeys, setLoadingKeys] = useState<Set<string>>(new Set());
    const loadedKeysRef = useRef<Set<string>>(new Set());

    // Root-level "+" create menu — folder or document, always created at
    // workspace root regardless of what's expanded, per the reference layout.
    const [createMenuOpen, setCreateMenuOpen] = useState(false);
    const [creatingType, setCreatingType] = useState<'folder' | 'document' | null>(null);
    const [createName, setCreateName] = useState("");
    const [createSubmitting, setCreateSubmitting] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);
    const createMenuRef = useRef<HTMLDivElement | null>(null);

    const loadChildren = useCallback((parentKey: string) => {
        if (loadedKeysRef.current.has(parentKey)) return;
        loadedKeysRef.current.add(parentKey);

        Promise.resolve().then(() => {
            setLoadingKeys((prev) => new Set(prev).add(parentKey));
        });

        Promise.all([
            apiClient.get<{ folders: FolderNode[] }>(`/api/workspaces/${workspaceId}/folders?parentId=${parentKey}`),
            apiClient.get<{ documents: DocNode[] }>(`/api/workspaces/${workspaceId}/documents?folderId=${parentKey}`),
        ])
            .then(([folderRes, docRes]) => {
                setFoldersByParent((prev) => ({ ...prev, [parentKey]: folderRes.folders }));
                setDocsByParent((prev) => ({ ...prev, [parentKey]: docRes.documents }));
            })
            .catch(() => {
                loadedKeysRef.current.delete(parentKey);
            })
            .finally(() => {
                setLoadingKeys((prev) => { const next = new Set(prev); next.delete(parentKey); return next; });
            });
    }, [workspaceId]);

    useEffect(() => {
        loadChildren('root');
        apiClient
            .get<{ workspace: { name: string; memberCount: number } }>(`/api/workspaces/${workspaceId}`)
            .then((res) => {
                setWorkspaceName(res.workspace.name);
                setMemberCount(res.workspace.memberCount);
            })
            .catch(() => { /* non-critical — sidebar still works without the name */ });
    }, [workspaceId, loadChildren]);

    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (createMenuRef.current && !createMenuRef.current.contains(e.target as Node)) {
                setCreateMenuOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    function toggleFolder(folderId: string) {
        setExpandedFolders((prev) => {
            const next = new Set(prev);
            if (next.has(folderId)) next.delete(folderId);
            else next.add(folderId);
            return next;
        });
        loadChildren(folderId);
    }

    function startCreate(type: 'folder' | 'document') {
        setCreatingType(type);
        setCreateMenuOpen(false);
        setCreateName("");
        setCreateError(null);
    }

    // Deliberately doesn't touch the POST response — refetches root via the
    // already-confirmed GET endpoints instead, so a wrong guess about the
    // create response shape can't silently break the list.
    async function submitCreate(e: FormEvent) {
        e.preventDefault();
        const name = createName.trim();
        if (!name || !creatingType) return;

        setCreateSubmitting(true);
        setCreateError(null);
        try {
            if (creatingType === 'folder') {
                await apiClient.post(`/api/workspaces/${workspaceId}/folders`, { name });
            } else {
                await apiClient.post(`/api/workspaces/${workspaceId}/documents`, { title: name });
            }
            loadedKeysRef.current.delete('root');
            setFoldersByParent((prev) => { const next = { ...prev }; delete next['root']; return next; });
            setDocsByParent((prev) => { const next = { ...prev }; delete next['root']; return next; });
            loadChildren('root');
            setCreatingType(null);
            setCreateName("");
        } catch {
            setCreateError("Couldn't create it — try again.");
        } finally {
            setCreateSubmitting(false);
        }
    }

    function renderLevel(parentKey: string, depth: number) {
        const folders = foldersByParent[parentKey] ?? [];
        const docs = docsByParent[parentKey] ?? [];
        const isLoadingThisLevel = loadingKeys.has(parentKey);

        return (
            <>
                {folders.map((folder) => {
                    const isOpen = expandedFolders.has(folder.id);
                    const childrenLoading = loadingKeys.has(folder.id) && foldersByParent[folder.id] === undefined;
                    return (
                        <div key={folder.id}>
                            <button
                                className="sidebar-row"
                                style={{ paddingLeft: 10 + depth * 14 }}
                                onClick={() => toggleFolder(folder.id)}
                            >
                                <span className="sidebar-chevron">{isOpen ? '▾' : '▸'}</span>
                                <FolderIcon />
                                <span className="sidebar-row-label">{folder.name}</span>
                            </button>
                            {isOpen && (childrenLoading
                                ? <div className="sidebar-loading" style={{ paddingLeft: 24 + depth * 14 }}>Loading…</div>
                                : renderLevel(folder.id, depth + 1))}
                        </div>
                    );
                })}

                {docs.map((doc) => (
                    <Link
                        key={doc.id}
                        href={`/workspaces/${workspaceId}/documents/${doc.id}`}
                        className={`sidebar-doc ${doc.id === activeDocumentId ? 'active' : ''}`}
                        style={{ paddingLeft: 24 + depth * 14 }}
                    >
                        <DocIcon />
                        <span className="sidebar-row-label">{doc.title || 'Untitled'}</span>
                    </Link>
                ))}

                {!isLoadingThisLevel && depth > 0 && folders.length === 0 && docs.length === 0 && (
                    <div className="sidebar-empty" style={{ paddingLeft: 24 + depth * 14 }}>Empty</div>
                )}
            </>
        );
    }

    return (
        <aside style={{ width: 240, flexShrink: 0, borderRight: "1px solid var(--border)", background: "var(--surface)", display: "flex", flexDirection: "column" }}>
            <div className="sidebar-brand">
                <div className="sidebar-logo"><SparkleIcon /></div>
                <span className="sidebar-brand-name">IntelliNote</span>
            </div>

            <div className="sidebar-search" title="Search isn't wired up yet">
                <SearchIcon />
                <span>Search workspace…</span>
            </div>

            <div className="sidebar-workspace-row">
                <Link href="/workspaces" className="section-label sidebar-workspace-link" style={{ margin: 0 }}>
                    {workspaceName ?? '…'}
                </Link>
                <div ref={createMenuRef} style={{ position: "relative" }}>
                    <button
                        className="sidebar-add-btn"
                        onClick={() => setCreateMenuOpen((v) => !v)}
                        title="New folder or document"
                        aria-label="New folder or document"
                    >
                        +
                    </button>
                    {createMenuOpen && (
                        <div className="sidebar-create-menu">
                            <button onClick={() => startCreate('folder')}>New folder</button>
                            <button onClick={() => startCreate('document')}>New document</button>
                        </div>
                    )}
                </div>
            </div>

            {creatingType && (
                <form onSubmit={submitCreate} className="sidebar-create-form">
                    <input
                        autoFocus
                        value={createName}
                        onChange={(e) => setCreateName(e.target.value)}
                        placeholder={creatingType === 'folder' ? 'Folder name' : 'Document title'}
                        disabled={createSubmitting}
                    />
                    <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.4rem" }}>
                        <button type="submit" className="btn-primary" disabled={createSubmitting || !createName.trim()} style={{ flex: 1 }}>
                            {createSubmitting ? 'Creating…' : 'Create'}
                        </button>
                        <button type="button" className="btn-secondary" onClick={() => setCreatingType(null)}>
                            Cancel
                        </button>
                    </div>
                    {createError && <p className="error-text" style={{ marginTop: "0.3rem" }}>{createError}</p>}
                </form>
            )}

            <div className="sidebar-tree">
                {renderLevel('root', 0)}
            </div>

            {memberCount != null && (
                <div className="sidebar-footer">{memberCount} member{memberCount === 1 ? '' : 's'}</div>
            )}
        </aside>
    );
}