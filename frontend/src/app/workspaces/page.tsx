"use client";

import { useEffect, useState, SyntheticEvent } from "react";
import RequireAuth from "@/components/RequireAuth";
import { apiClient, ApiError } from "@/lib/apiClient";
import type { Workspace } from "@/types/workspace";

function WorkspaceContent() {
    const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        let cancelled = false;

        apiClient
            .get<{ workspaces: Workspace[] }>("/api/workspaces")
            .then(({ workspaces }) => {
                if (!cancelled) setWorkspaces(workspaces);
            })
            .catch((err) => {
                if (!cancelled) {
                    setError(err instanceof ApiError ? err.message : "Failed to load workspaces.");
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, []);

    async function handleCreate(e: SyntheticEvent<HTMLFormElement>) {
        e.preventDefault();
        setCreating(true);
        setError(null);

        try {
            const { workspace } = await apiClient.post<{ workspace: Workspace }>("/api/workspaces", {
                name,
                description,
            });
            setWorkspaces((prev) => [...prev, workspace]);
            setName("");
            setDescription("");
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Failed to create workspace.");
        } finally {
            setCreating(false);
        }
    }

    if (loading) return <p className="muted">Loading workspaces…</p>;

    return (
        <div style={{ maxWidth: "560px", margin: "0 auto", padding: "3rem 1.5rem" }}>
            <h1>Your workspaces</h1>

            {error && <p className="error-text">{error}</p>}

            {workspaces.length === 0 ? (
                <div className="card" style={{ marginBottom: "1.5rem" }}>
                    <p style={{ margin: "0 0 0.5rem", fontWeight: 500 }}>Start your first workspace</p>
                    <p className="muted" style={{ margin: 0 }}>
                        A workspace holds your folders, documents, and collaborators for one project or team.
                    </p>
                </div>
            ) : (
                <ul style={{ listStyle: "none", padding: 0, marginBottom: "1.5rem" }}>
                    {workspaces.map((ws) => (
                        <li key={ws.id} className="card" style={{ marginBottom: "0.5rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <a href={`/workspaces/${ws.id}`} style={{ fontWeight: 500 }}>{ws.name}</a>
                            <span className="muted">{ws.role}</span>
                        </li>
                    ))}
                </ul>
            )}

            <h2>Create a workspace</h2>

            <form onSubmit={handleCreate} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <div>
                    <label htmlFor="name">Name</label>
                    <input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%" }} required />
                </div>
                <div>
                    <label htmlFor="description">Description</label>
                    <input id="description" type="text" value={description} onChange={(e) => setDescription(e.target.value)} style={{ width: "100%" }} />
                </div>

                <button type="submit" className="btn-primary" disabled={creating} style={{ alignSelf: "flex-start" }}>
                    {creating ? "Creating…" : "Create workspace"}
                </button>
            </form>
        </div>
    );
}

export default function WorkspacePage() {
    return (
        <RequireAuth>
            <WorkspaceContent />
        </RequireAuth>
    );
}