"use client";
import { useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  Check,
  Heart,
  MapPin,
  Navigation,
  Pencil,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { api, messageOf, RequestError } from "@/lib/client";
import { attendanceLabels, invitation, wazeUrl, type Rsvp } from "@/lib/event";
import { Button } from "@/components/ui/button";
import { emptyForm, RsvpFields, type FormValues } from "./fields";

type Mine = Pick<Rsvp, "id" | "full_name" | "attendance">;
const activeKey = "anael:activeRsvpId";
const requestKey = "anael:pendingRequestKey";
function readLocal(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLocal(key: string, value: string | null) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* Works without browser storage too. */
  }
}

export function Guest({ recovery = false }: { recovery?: boolean }) {
  const [values, setValues] = useState<FormValues>(emptyForm);
  const [active, setActive] = useState<Rsvp | null>(null);
  const [mode, setMode] = useState<"form" | "thanks">("form");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState(true);
  const [showInvitation, setShowInvitation] = useState(false);
  const operation = useRef(0);
  const pendingKey = useRef<string | null>(null);
  const submitting = useRef(false);
  const initialization = useRef<Promise<{
    open: boolean;
    record: Rsvp | null;
    list: Mine[];
    claimed: boolean;
  }> | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  function select(record: Rsvp, thanks = false) {
    setActive(record);
    setValues({
      fullName: record.full_name,
      attendance: record.attendance,
      guestCount: record.guest_count || 1,
    });
    writeLocal(activeKey, record.id);
    setMode(thanks ? "thanks" : "form");
  }
  useEffect(() => {
    let cancelled = false;
    if (!initialization.current) {
      // Remove the secret before network requests; share initialization across StrictMode effect replay.
      const token = recovery
        ? new URLSearchParams(window.location.hash.slice(1)).get("token")
        : null;
      if (window.location.hash)
        history.replaceState(
          null,
          "",
          window.location.pathname + window.location.search,
        );
      initialization.current = (async () => {
        const [event, claimed] = await Promise.all([
          api<{ open: boolean }>("event"),
          token
            ? api<{ rsvp: Rsvp }>("rsvps/claim", {
                method: "POST",
                body: { token },
              })
            : Promise.resolve(null),
        ]);
        const list = (await api<{ rsvps: Mine[] }>("rsvps/mine")).rsvps;
        const stored = readLocal(activeKey);
        const id = list.some((r) => r.id === stored) ? stored : list[0]?.id;
        const record =
          claimed?.rsvp ??
          (id ? (await api<{ rsvp: Rsvp }>(`rsvps/${id}`)).rsvp : null);
        return { open: event.open, record, list, claimed: Boolean(claimed) };
      })();
    }
    async function initialize() {
      try {
        const result = await initialization.current!;
        if (cancelled) return;
        setOpen(result.open);
        if (result.record) select(result.record);
        else {
          writeLocal(activeKey, null);
          if (recovery)
            setNotice(
              "לעריכת אישור קיים, פתחו את האתר באותו דפדפן שבו מילאתם אותו",
            );
        }
        if (result.claimed)
          setNotice("האישור שלכם שוחזר. אפשר לעדכן את הפרטים");
      } catch (err) {
        if (!cancelled) setError(messageOf(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void initialize();
    return () => {
      cancelled = true;
    };
    // Initialization only. No browser secret is persisted in React effects or localStorage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recovery]);
  useEffect(() => {
    if (showInvitation) dialog.current?.showModal();
    else dialog.current?.close();
  }, [showInvitation]);

  async function switchTo(id: string) {
    if (busy) return;
    const current = ++operation.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api<{ rsvp: Rsvp }>(`rsvps/${id}`);
      if (operation.current === current) select(result.rsvp);
    } catch (err) {
      if (err instanceof RequestError && [401, 404].includes(err.status)) {
        if (active?.id === id) {
          setActive(null);
          setValues(emptyForm);
          writeLocal(activeKey, null);
        }
      }
      setError(messageOf(err));
    } finally {
      if (operation.current === current) setBusy(false);
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current || !values.attendance) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const input = {
      fullName: values.fullName,
      attendance: values.attendance,
      guestCount: values.attendance === "yes" ? values.guestCount : 0,
    };
    try {
      if (active) {
        const result = await api<{ rsvp: Rsvp }>(`rsvps/${active.id}`, {
          method: "PATCH",
          body: { ...input, expectedVersion: active.version },
        });
        select(result.rsvp, true);
        setNotice("העדכון נשמר בהצלחה");
      } else {
        await api("session", { method: "POST" });
        const key =
          pendingKey.current ?? readLocal(requestKey) ?? crypto.randomUUID();
        pendingKey.current = key;
        writeLocal(requestKey, key);
        const result = await api<{
          rsvp: Rsvp;
          replayed: boolean;
        }>("rsvps", { method: "POST", body: { ...input, requestKey: key } });
        select(result.rsvp, true);
        pendingKey.current = null;
        writeLocal(requestKey, null);
        if (result.replayed)
          setNotice("האישור כבר נשמר. אפשר לעדכן אותו מאותו דפדפן");
      }
    } catch (err) {
      if (err instanceof RequestError && err.code === "EXISTING_RSVP") {
        try {
          const list = (await api<{ rsvps: Mine[] }>("rsvps/mine")).rsvps;
          const stored = readLocal(activeKey);
          const id = list.some((r) => r.id === stored) ? stored : list[0]?.id;
          if (!id) throw err;
          select((await api<{ rsvp: Rsvp }>(`rsvps/${id}`)).rsvp);
          pendingKey.current = null;
          writeLocal(requestKey, null);
          setNotice(
            "כבר קיים אישור בדפדפן הזה. הפרטים הקיימים נטענו ואפשר לעדכן אותם",
          );
        } catch (loadError) {
          setError(messageOf(loadError));
        }
      } else {
        setError(messageOf(err));
      }
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  }

  return (
    <div className="guest-page">
      <header className="site-header">
        <span className="blessing">בס״ד</span>
      </header>
      <main id="main" className="guest-main">
        <section className="invitation-panel" aria-label="ההזמנה לבריתה">
          <button
            className="invitation-image-button"
            onClick={() => setShowInvitation(true)}
            aria-label="הצגת ההזמנה המלאה"
          >
            <img
              src="/invitation.jpeg"
              alt="הזמנה לבריתה של אנאל, 18 באוקטובר 2026 בשעה 19:30, אולם אצולת העמק בעפולה, עדי ועדן תמיר"
              className="invitation-image"
            />
          </button>
          <p className="image-caption">
            רגע קטן, אהבה גדולה <Heart size={14} aria-hidden="true" />
          </p>
        </section>
        <section className="rsvp-panel" aria-labelledby="rsvp-heading">
          <div className="invitation-copy">
            <span className="eyebrow" lang="en">
              IT’S A GIRL!
            </span>
            <h1 id="rsvp-heading">
              <span>אנאל</span>
            </h1>
            <p>
              {invitation.text} <strong>אנאל</strong>.
            </p>
            <p className="hosts">נשמח לראותכם · {invitation.hosts}</p>
          </div>
          <div className="event-details">
            <div>
              <CalendarDays size={20} aria-hidden="true" />
              <span>
                <strong>{invitation.date}</strong>
                <small>
                  {invitation.day} · {invitation.time}
                </small>
              </span>
            </div>
            <div>
              <MapPin size={20} aria-hidden="true" />
              <span>
                <strong>{invitation.venue}</strong>
                <small>{invitation.city}</small>
              </span>
            </div>
          </div>
          <div className="venue-navigation">
            <p>{invitation.address}</p>
            <Button asChild variant="outline">
              <a
                href={wazeUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`ניווט ב־Waze אל ${invitation.venue}, ${invitation.address}`}
              >
                <Navigation size={19} aria-hidden="true" />
                ניווט ב־Waze
              </a>
            </Button>
          </div>
          <div className="rsvp-card" aria-busy={loading || busy}>
            {loading ? (
              <p className="loading">
                <RefreshCw className="spin" size={18} /> טוענים את האישור שלכם…
              </p>
            ) : (
              <>
                <div className="card-heading">
                  <span className="section-marker">
                    <Heart size={17} aria-hidden="true" />
                  </span>
                  <div>
                    <h2>
                      {mode === "thanks"
                        ? "תודה, התשובה שלכם נשמרה"
                        : active
                          ? "מעדכנים את האישור שלכם"
                          : "נשמח לדעת אם תגיעו"}
                    </h2>
                    <p>
                      {mode === "thanks"
                        ? "מחכים לחגוג איתכם"
                        : active
                          ? "השינויים יישמרו באותו אישור"
                          : "כמה פרטים קטנים, ואנחנו מוכנים לחגוג"}
                    </p>
                  </div>
                </div>
                {error && (
                  <div role="alert" className="message error">
                    {error}
                    {active && (
                      <Button
                        variant="ghost"
                        type="button"
                        disabled={busy}
                        onClick={() => void switchTo(active.id)}
                      >
                        טעינת האישור מחדש
                      </Button>
                    )}
                  </div>
                )}
                {notice && (
                  <p role="status" className="message notice">
                    {notice}
                  </p>
                )}
                {!open && (
                  <p className="message notice">
                    ההרשמה לאירוע נסגרה. אפשר לצפות באישור הקיים
                  </p>
                )}
                {mode === "thanks" && active ? (
                  <div className="thanks">
                    <div className="success-icon">
                      <Check size={28} aria-hidden="true" />
                    </div>
                    <h3>{active.full_name}</h3>
                    <p>
                      {attendanceLabels[active.attendance]}
                      {active.attendance === "yes"
                        ? ` · ${active.guest_count} משתתפים`
                        : ""}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy || !open}
                      onClick={() => {
                        setMode("form");
                        setNotice("");
                      }}
                    >
                      <Pencil size={16} /> עריכת האישור
                    </Button>
                    <p className="field-note">
                      לעריכה בהמשך, פתחו את קישור ההזמנה מאותו מכשיר ובאותו
                      דפדפן שבו מילאתם את האישור.
                    </p>
                  </div>
                ) : (
                  <form onSubmit={submit}>
                    <RsvpFields
                      value={values}
                      onChange={setValues}
                      disabled={busy || !open}
                    />
                    <Button
                      type="submit"
                      className="submit-button"
                      disabled={busy || !open}
                    >
                      {busy ? (
                        <RefreshCw size={18} className="spin" />
                      ) : (
                        <Heart size={18} />
                      )}
                      {busy
                        ? "שומרים…"
                        : active
                          ? "שמירת השינויים"
                          : "שליחת אישור הגעה"}
                    </Button>
                  </form>
                )}
              </>
            )}
          </div>
          <p className="privacy-note">
            <ShieldCheck size={14} aria-hidden="true" /> הפרטים שלכם משמשים
            לתכנון האירוע בלבד
          </p>
          <button
            className="mobile-invitation-link"
            type="button"
            onClick={() => setShowInvitation(true)}
          >
            לצפייה בהזמנה המלאה
          </button>
        </section>
      </main>
      <dialog
        ref={dialog}
        className="invitation-dialog"
        onCancel={() => setShowInvitation(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setShowInvitation(false);
        }}
      >
        <Button
          variant="outline"
          className="dialog-close"
          onClick={() => setShowInvitation(false)}
        >
          סגירה
        </Button>
        <img src="/invitation.jpeg" alt="ההזמנה המלאה לבריתה של אנאל" />
      </dialog>
    </div>
  );
}
