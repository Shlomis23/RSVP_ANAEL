"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole, ArrowRight } from "lucide-react";
import { api, messageOf } from "@/lib/client";
import { Button } from "@/components/ui/button";
export default function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api("admin/login", { method: "POST", body: { password } });
      setPassword("");
      router.replace("/admin");
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main id="main" className="login-page">
      <a className="back-link" href="/">
        <ArrowRight size={17} /> חזרה להזמנה
      </a>
      <section className="login-card">
        <div className="section-marker">
          <LockKeyhole size={23} />
        </div>
        <span className="eyebrow">הבריתה של אנאל</span>
        <h1>כניסה לניהול</h1>
        <p>כל אישורי ההגעה, במקום אחד</p>
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="password">סיסמת ניהול</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={200}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
          </div>
          {error && (
            <p role="alert" className="message error">
              {error}
            </p>
          )}
          <Button className="submit-button" disabled={busy}>
            {busy ? "נכנסים…" : "כניסה"}
          </Button>
        </form>
        <p className="field-note">הגישה למנהלת האירוע בלבד</p>
      </section>
    </main>
  );
}
