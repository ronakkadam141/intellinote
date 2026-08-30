"use client";

import { useEffect, useState, FormEvent } from "react";
import Link from "next/link";
import RequireAuth from "@/components/RequireAuth";
import { apiClient, ApiError } from "@/lib/apiClient";
import SparkleIcon from "@/components/icons/SparkleIcon";

interface Workspace {
    id: string;
    name: string;
    description?: string | null;
    role: "owner" | "editor" | "viewer";
}

function initialsFor(name: string): string {
    const trimmed = name.trim();
    if (!trimmed) return "?";
    const words = trimmed.split(/\s+/);
    if (words.length >= 2) {
        return (words[0][0] + words[1][0]).toUpperCase();
    }
    return trimmed.slice(0, 2).toUpperCase();
}

function WorkspacesContent() {
    const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [creating, setCreating] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        apiClient
            .get<{ workspaces: Workspace[] }>("/api/workspaces")
            .then((res) => {
                if (!cancelled) setWorkspaces(res.workspaces);
            })
            .catch((err) => {
                if (!cancelled) setError(err instanceof ApiError ? err.message : "Failed to load workspaces.");
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    async function handleCreate(e: FormEvent) {
        e.preventDefault();
        if (!name.trim()) return;
        setCreating(true);
        setCreateError(null);
        try {
            const res = await apiClient.post<{ workspace: Workspace }>("/api/workspaces", {
                name: name.trim(),
                description: description.trim() || undefined,
            });
            setWorkspaces((prev) => [...prev, res.workspace]);
            setName("");
            setDescription("");
        } catch (err) {
            setCreateError(err instanceof ApiError ? err.message : "Failed to create workspace.");
        } finally {
            setCreating(false);
        }
    }

    if (loading) return <p className="muted" style={{ padding: "3rem" }}>Loading workspaces…</p>;

    return (
        <div className="page-container">
            <div className="sidebar-brand" style={{ padding: 0 }}>
                <div className="sidebar-logo"><SparkleIcon /></div>
                <span className="sidebar-brand-name">IntelliNote</span>
            </div>

            <h1 style={{ marginTop: "2rem" }}>Your workspaces</h1>

            {error && <p className="error-text" style={{ marginTop: "0.75rem" }}>{error}</p>}

            {workspaces.length === 0 ? (
                <div className="callout" style={{ marginTop: "1.5rem" }}>
                    <p className="muted" style={{ margin: 0 }}>
                        You don&apos;t have any workspaces yet — create one below to get started.
                    </p>
                </div>
            ) : (
                <>
                    <p className="muted" style={{ marginTop: "0.4rem" }}>
                        {workspaces.length} workspace{workspaces.length === 1 ? "" : "s"}
                    </p>
                    <div className="workspace-grid">
                        {workspaces.map((w) => (
                            <Link key={w.id} href={`/workspaces/${w.id}`} className="workspace-card">
                                <div className="workspace-card-icon">{initialsFor(w.name)}</div>
                                <div className="workspace-card-body">
                                    <div className="workspace-card-name">{w.name}</div>
                                    {w.description && <div className="workspace-card-desc">{w.description}</div>}
                                </div>
                                <span className={`role-badge role-${w.role}`}>{w.role}</span>
                            </Link>
                        ))}
                    </div>
                </>
            )}

            <div className="section">
                <div className="section-label">Create a workspace</div>
                <form onSubmit={handleCreate} className="workspace-form">
                    <div>
                        <label>Name</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. Bio 201 Study Group"
                            required
                        />
                    </div>
                    <div>
                        <label>Description</label>
                        <input
                            type="text"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Optional"
                        />
                    </div>
                    {createError && <p className="error-text">{createError}</p>}
                    <button type="submit" className="btn-primary" disabled={creating} style={{ alignSelf: "flex-start" }}>
                        {creating ? "Creating…" : "Create workspace"}
                    </button>
                </form>
            </div>
        </div>
    );
}

export default function WorkspacesPage() {
    return (
        <RequireAuth>
            <WorkspacesContent />
        </RequireAuth>
    );
}