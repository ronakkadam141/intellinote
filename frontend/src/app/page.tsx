import RedirectIfAuthed from "@/components/RedirectIfAuthed";

export default function LandingPage(){
  return (
    <RedirectIfAuthed>
      <div>
        <h1>Intellinote</h1>
        <p>AI-powered collaborative learning workspace</p>
        <a href="/login">Login</a>
        <a href="/register">Register</a>
      </div>
    </RedirectIfAuthed>
  );
}