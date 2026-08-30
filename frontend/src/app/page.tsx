import RedirectIfAuthed from "@/components/RedirectIfAuthed";
import Link from "next/link";
import SparkleIcon from "@/components/icons/SparkleIcon";

export default function LandingPage() {
    return (
        <RedirectIfAuthed>
            <div className="landing-hero">
                <div className="sidebar-brand" style={{ padding: 0 }}>
                    <div className="sidebar-logo"><SparkleIcon /></div>
                    <span className="sidebar-brand-name">IntelliNote</span>
                </div>

                <h1 className="landing-title">
                    Take notes, collaborate live, and get AI help exactly where you&apos;re working.
                </h1>
                <p className="landing-subtitle">AI-powered collaborative learning workspace</p>

                <div className="landing-actions">
                    <Link href="/register" className="btn-primary">Get started</Link>
                    <Link href="/login" className="btn-secondary">Log in</Link>
                </div>
            </div>
        </RedirectIfAuthed>
    );
}