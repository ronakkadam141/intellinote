"use client";

import { useState, SyntheticEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { ApiError } from "@/lib/apiClient";

const USERNAME_ADJECTIVES = ["swift", "quiet", "amber", "brisk", "clever", "golden", "lunar", "vivid", "keen", "coral"];
const USERNAME_NOUNS = ["otter", "finch", "maple", "comet", "harbor", "ember", "willow", "falcon", "reef", "cedar"];

function generateUsername(): string {
    const adjective = USERNAME_ADJECTIVES[Math.floor(Math.random() * USERNAME_ADJECTIVES.length)];
    const noun = USERNAME_NOUNS[Math.floor(Math.random() * USERNAME_NOUNS.length)];
    const suffix = Math.floor(Math.random() * 900 + 100); // 100-999
    return `${adjective}-${noun}-${suffix}`;
}

export default function RegisterPage() {
    const { register } = useAuth();
    const router = useRouter();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [displayName, setDisplayName] = useState(() => generateUsername());
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    async function handleSubmit(e: SyntheticEvent<HTMLFormElement>) {
        e.preventDefault();
        setError(null);
        setSubmitting(true);

        try {
            await register(email, password, displayName);
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
                    <label htmlFor="displayName">
                        Username{" "}
                        <button
                            type="button"
                            className="text-action"
                            style={{ fontSize: "11px", padding: 0 }}
                            onClick={() => setDisplayName(generateUsername())}
                        >
                            Generate a new one
                        </button>
                    </label>
                    <input
                        id="displayName"
                        type="text"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        style={{ width: "100%" }}
                        required
                    />
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