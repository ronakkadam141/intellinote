"use client";

import { useState, SyntheticEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { ApiError } from "@/lib/apiClient";

export default function RegisterPage() {
    const { register } = useAuth();
    const router = useRouter();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [displayName, setDisplayName] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    async function handleSubmit(e: SyntheticEvent<HTMLFormElement>) {
        e.preventDefault();
        setError(null);
        setSubmitting(true);

        try {
            await register(email, password, displayName || undefined);
            router.push("/workspaces");
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div style={{ maxWidth: "360px", margin: "5rem auto", padding: "0 1.5rem" }}>
            <h1 style={{ marginBottom: "1.5rem" }}>Create an account</h1>
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <div>
                    <label htmlFor="displayName">Name (optional)</label>
                    <input id="displayName" type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} style={{ width: "100%" }} />
                </div>

                <div>
                    <label htmlFor="email">Email</label>
                    <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: "100%" }} required />
                </div>

                <div>
                    <label htmlFor="password">Password</label>
                    <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ width: "100%" }} required />
                </div>

                {error && <p className="error-text">{error}</p>}

                <button type="submit" className="btn-primary" disabled={submitting}>
                    {submitting ? "Creating account…" : "Create account"}
                </button>
            </form>

            <p className="muted" style={{ marginTop: "1.5rem" }}>
                Already have an account? <a href="/login">Log in</a>
            </p>
        </div>
    );
}