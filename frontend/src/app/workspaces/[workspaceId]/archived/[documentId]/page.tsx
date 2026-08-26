"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import ResizableImage from "tiptap-extension-resize-image";
import RequireAuth from "@/components/RequireAuth";
import { apiClient, ApiError } from "@/lib/apiClient";

interface ArchivedDocumentDetail {
    id: string;
    title: string;
    content: unknown;
    workspaceId: string;
    folderId: string | null;
}

function ArchivedDocumentContent() {
    const { workspaceId, documentId } = useParams<{ workspaceId: string; documentId: string }>();
    const [doc, setDoc] = useState<ArchivedDocumentDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        apiClient
            .get<{ document: ArchivedDocumentDetail }>(`/api/workspaces/${workspaceId}/documents/archived/${documentId}`)
            .then((res) => {
                if (!cancelled) setDoc(res.document);
            })
            .catch((err) => {
                if (!cancelled) setError(err instanceof ApiError ? err.message : "Failed to load archived document.");
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [workspaceId, documentId]);

    // Deliberately no Collaboration/Yjs extension here — this is a static
    // snapshot of last-saved content, not a live session. There is also no
    // ws-ticket path for archived documents (issueWsTicket requires
    // isArchived:false), so a live session couldn't be opened here even if
    // this page tried to; read-only is enforced structurally, not just by
    // editable:false.
    const editor = useEditor(
        {
            immediatelyRender: false,
            editable: false,
            extensions: [StarterKit, ResizableImage],
            content: doc?.content ?? { type: "doc", content: [] },
        },
        [doc],
    );

    if (loading) return <p>Loading archived document…</p>;
    if (error) return <p className="error-text">{error}</p>;

    return (
        <div style={{ maxWidth: "760px", margin: "0 auto", padding: "3.5rem 1.5rem" }}>
            <p className="muted" style={{ marginBottom: "0.5rem" }}>
                <Link href={`/workspaces/${workspaceId}`}>← Back to workspace</Link>
            </p>
            <h1>{doc?.title}</h1>
            <p className="muted">
                This document is archived — read-only. Restore it from the workspace page to edit.
            </p>
            <EditorContent editor={editor} />
        </div>
    );
}

export default function ArchivedDocumentPage() {
    return (
        <RequireAuth>
            <ArchivedDocumentContent />
        </RequireAuth>
    );
}