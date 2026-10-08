"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Download,
  Heart,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { api, messageOf, RequestError } from "@/lib/client";
import { describeAudit, type AuditEntry } from "@/lib/audit-description";
import {
  attendanceLabels,
  invitation,
  type Attendance,
  type Rsvp,
} from "@/lib/event";
import {
  RsvpFields,
  emptyForm,
  type FormValues,
} from "@/components/rsvp/fields";
import { Button } from "@/components/ui/button";

type Data = {
  rsvps: Rsvp[];
  total: number;
  page: number;
  pageSize: number;
  stats: {
    responses: number;
    guests: number;
    yes: number;
    no: number;
    maybe: number;
  };
  event: { isActive: boolean; registrationClosesAt: string | null };
};
type Pair = { first: Rsvp; second: Rsvp; score: number };
const date = (value: string) =>
  new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));

export function Admin() {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<"guests" | "duplicates" | "audit">("guests");
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [pairTotal, setPairTotal] = useState(0);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<Rsvp | "new" | null>(null);
  const [values, setValues] = useState<FormValues>(emptyForm);
  const [editorError, setEditorError] = useState("");
  const [confirm, setConfirm] = useState<{
    title: string;
    description: string;
    run: () => Promise<void>;
  } | null>(null);
  const editorDialog = useRef<HTMLDialogElement>(null);
  const confirmDialog = useRef<HTMLDialogElement>(null);
  const downloadBusy = useRef(false);
  const queryString = new URLSearchParams({
    q: query,
    status,
    page: String(page),
  }).toString();
  const handleError = useCallback(
    (err: unknown) => {
      if (err instanceof RequestError && err.status === 401) {
        setData(null);
        router.replace("/admin/login");
        return;
      }
      setError(messageOf(err));
    },
    [router],
  );
  useEffect(() => {
    const timeout = setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timeout);
  }, [search]);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError("");
      try {
        const result = await api<Data>(`admin/rsvps?${queryString}`, {
          signal,
        });
        setData(result);
        if (tab === "duplicates") {
          const duplicates = await api<{ pairs: Pair[]; total: number }>(
            "admin/duplicates",
            { signal },
          );
          setPairs(duplicates.pairs);
          setPairTotal(duplicates.total);
        }
        if (tab === "audit") {
          const audit = await api<{ entries: AuditEntry[] }>("admin/audit", {
            signal,
          });
          setEntries(audit.entries);
        }
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError"))
          handleError(err);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [queryString, tab, handleError],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  useEffect(() => {
    if (editor) editorDialog.current?.showModal();
    else editorDialog.current?.close();
  }, [editor]);
  useEffect(() => {
    if (confirm) confirmDialog.current?.showModal();
    else confirmDialog.current?.close();
  }, [confirm]);
  function openEditor(record: Rsvp | "new") {
    setEditorError("");
    setEditor(record);
    setValues(
      record === "new"
        ? { ...emptyForm }
        : {
            fullName: record.full_name,
            attendance: record.attendance,
            guestCount: record.guest_count || 1,
          },
    );
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editor || busy || !values.attendance) return;
    setBusy(true);
    setEditorError("");
    try {
      const payload = {
        fullName: values.fullName,
        attendance: values.attendance,
        guestCount: values.attendance === "yes" ? values.guestCount : 0,
      };
      await api(editor === "new" ? "admin/rsvps" : `admin/rsvps/${editor.id}`, {
        method: editor === "new" ? "POST" : "PATCH",
        body:
          editor === "new"
            ? payload
            : { ...payload, expectedVersion: editor.version },
      });
      setEditor(null);
      setNotice("האישור נשמר בהצלחה");
      await load();
    } catch (err) {
      setEditorError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }
  async function confirmed() {
    if (!confirm || busy) return;
    setBusy(true);
    setError("");
    try {
      await confirm.run();
      setConfirm(null);
      await load();
    } catch (err) {
      setConfirm(null);
      handleError(err);
    } finally {
      setBusy(false);
    }
  }
  async function exportExcel() {
    if (downloadBusy.current) return;
    downloadBusy.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/export?${queryString}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        const body = await response.json();
        throw new RequestError(
          body.error.message,
          body.error.code,
          response.status,
        );
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "anael-rsvp.xlsx";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
      downloadBusy.current = false;
    }
  }
  async function logout() {
    if (busy) return;
    setBusy(true);
    try {
      await api("admin/logout", { method: "POST" });
      router.replace("/admin/login");
    } catch (err) {
      handleError(err);
      setBusy(false);
    }
  }
  function deleteRecord(record: Rsvp) {
    setConfirm({
      title: "מחיקת אישור",
      description: `למחוק את האישור של ${record.full_name}? האישור יוסר מהסיכומים ומרשימת האורחים, וקישורי העריכה שלו יבוטלו.`,
      run: async () => {
        await api(`admin/rsvps/${record.id}`, {
          method: "DELETE",
          body: { expectedVersion: record.version, confirmed: true },
        });
        setNotice("האישור הוסר");
      },
    });
  }
  function decide(
    pair: Pair,
    decision: "merge" | "not_duplicate",
    winnerId?: string,
  ) {
    const winner = winnerId === pair.first.id ? pair.first : pair.second;
    setConfirm({
      title: decision === "merge" ? "איחוד אישורים" : "סימון כאישורים נפרדים",
      description:
        decision === "merge"
          ? `יישמר האישור של ${winner.full_name} (${attendanceLabels[winner.attendance]}, ${winner.guest_count} משתתפים). האישור השני יוסר, וההרשאות שלו יבוטלו. הכמויות לא יחוברו.`
          : "שני האישורים יישארו ברשימה. החשד יופיע שוב רק אם אחד מהם יעודכן.",
      run: async () => {
        await api("admin/duplicates", {
          method: "POST",
          body: {
            firstId: pair.first.id,
            secondId: pair.second.id,
            firstVersion: pair.first.version,
            secondVersion: pair.second.version,
            decision,
            winnerId,
            confirmed: true,
          },
        });
        setNotice("ההחלטה נשמרה");
      },
    });
  }
  function toggleRegistration() {
    if (!data) return;
    const active = !data.event.isActive;
    setConfirm({
      title: active ? "פתיחת הרשמה" : "סגירת הרשמה",
      description: active
        ? "אורחים יוכלו לשלוח ולעדכן אישורי הגעה, בהתאם למועד הסגירה שהוגדר."
        : "אורחים יוכלו לצפות באישורים קיימים, אך לא לשלוח או לעדכן אותם. אפשר לפתוח מחדש בכל עת.",
      run: async () => {
        await api("admin/event", {
          method: "PATCH",
          body: {
            isActive: active,
            registrationClosesAt: data.event.registrationClosesAt,
          },
        });
        setNotice(active ? "ההרשמה נפתחה" : "ההרשמה נסגרה");
      },
    });
  }
  if (!data) {
    return (
      <main id="main" className="login-page" aria-busy={loading}>
        {error ? (
          <section className="login-card">
            <p role="alert" className="message error">
              {error}
            </p>
            <Button variant="outline" onClick={() => void load()}>
              ניסיון נוסף
            </Button>
          </section>
        ) : (
          <p className="loading" role="status">
            טוענים…
          </p>
        )}
      </main>
    );
  }
  return (
    <div className="admin-page">
      <header className="admin-header">
        <a className="brand" href="/">
          <span className="brand-monogram">א</span>
          <span>
            אנאל <small>ניהול האירוע</small>
          </span>
        </a>
        <Button variant="ghost" disabled={busy} onClick={() => void logout()}>
          <LogOut size={17} /> יציאה
        </Button>
      </header>
      <main id="main" className="admin-main">
        <div className="admin-title">
          <div>
            <span className="eyebrow">
              {invitation.date} · {invitation.venue}
            </span>
            <h1>כל מי שחוגג איתנו</h1>
            <p>אישורי ההגעה לבריתה של אנאל</p>
          </div>
          <div className="toolbar">
            <Button
              variant="outline"
              disabled={busy || !data}
              onClick={() => void exportExcel()}
            >
              <Download size={17} /> ייצוא Excel
            </Button>
            <Button disabled={busy} onClick={() => openEditor("new")}>
              <Plus size={17} /> הוספת אישור
            </Button>
          </div>
        </div>
        {error && (
          <p role="alert" className="message error">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="message notice">
            {notice}
          </p>
        )}
        <div className="stats-grid">
          {[
            { label: "משתתפים מגיעים", value: data?.stats.guests, icon: Heart },
            {
              label: "אישורים שהתקבלו",
              value: data?.stats.responses,
              icon: Users,
            },
            { label: "לא מגיעים", value: data?.stats.no, icon: Check },
            { label: "מתלבטים", value: data?.stats.maybe, icon: RefreshCw },
          ].map(({ label, value, icon: Icon }) => (
            <article className="stat" key={label}>
              <Icon size={20} aria-hidden="true" />
              <strong>{value ?? "—"}</strong>
              <span>{label}</span>
            </article>
          ))}
        </div>
        <div className="admin-tabs" role="group" aria-label="תצוגה">
          {(
            [
              { id: "guests", label: "רשימת אורחים" },
              { id: "duplicates", label: "חשדות לכפילות" },
              { id: "audit", label: "היסטוריית פעולות" },
            ] as const
          ).map(({ id, label }) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              aria-pressed={tab === id}
              disabled={busy}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <section className="admin-content" aria-busy={loading}>
          {tab === "guests" ? (
            <>
              <div className="list-toolbar">
                <div className="search-field">
                  <Search size={18} aria-hidden="true" />
                  <input
                    aria-label="חיפוש לפי שם"
                    placeholder="חיפוש לפי שם…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <select
                  aria-label="סינון לפי סטטוס"
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">כל הסטטוסים</option>
                  {Object.entries(attendanceLabels).map(([key, value]) => (
                    <option key={key} value={key}>
                      {value}
                    </option>
                  ))}
                </select>
                <Button
                  variant="ghost"
                  aria-label="רענון הרשימה"
                  disabled={loading || busy}
                  onClick={() => void load()}
                >
                  <RefreshCw size={18} className={loading ? "spin" : ""} />
                </Button>
              </div>
              <div className="table-scroll">
                <table className="guest-table">
                  <thead>
                    <tr>
                      <th>שם מלא</th>
                      <th>סטטוס</th>
                      <th>משתתפים</th>
                      <th>מקור</th>
                      <th>עדכון אחרון</th>
                      <th>פעולות</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data?.rsvps.map((record) => (
                      <tr key={record.id}>
                        <td className="guest-name">{record.full_name}</td>
                        <td>
                          <span
                            className={`status-badge status-${record.attendance}`}
                          >
                            {attendanceLabels[record.attendance]}
                          </span>
                        </td>
                        <td>{record.guest_count}</td>
                        <td>{record.source === "guest" ? "אורח" : "מנהלת"}</td>
                        <td>{date(record.updated_at)}</td>
                        <td>
                          <div className="row-actions">
                            <Button
                              variant="ghost"
                              aria-label={`עריכת ${record.full_name}`}
                              disabled={busy}
                              onClick={() => openEditor(record)}
                            >
                              <Pencil size={17} />
                            </Button>
                            <Button
                              variant="ghost"
                              aria-label={`מחיקת ${record.full_name}`}
                              disabled={busy}
                              onClick={() => deleteRecord(record)}
                            >
                              <Trash2 size={17} />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!loading && data?.rsvps.length === 0 && (
                <div className="empty-state">
                  <Users size={32} />
                  <h3>
                    {query || status
                      ? "לא נמצאו אישורים מתאימים"
                      : "מחכים לאישורים הראשונים"}
                  </h3>
                  <p>
                    {query || status
                      ? "נסו לשנות את החיפוש או הסינון"
                      : "שתפו את קישור ההזמנה עם האורחים"}
                  </p>
                </div>
              )}
              <div className="pagination">
                <span>
                  {data?.total ?? 0} אישורים{loading ? " · טוענים…" : ""}
                </span>
                <div>
                  <Button
                    variant="ghost"
                    disabled={page <= 1 || loading}
                    onClick={() => setPage(page - 1)}
                  >
                    הקודם
                  </Button>
                  <span>עמוד {page}</span>
                  <Button
                    variant="ghost"
                    disabled={!data || page * 50 >= data.total || loading}
                    onClick={() => setPage(page + 1)}
                  >
                    הבא
                  </Button>
                </div>
              </div>
            </>
          ) : tab === "duplicates" ? (
            <>
              <div className="content-heading">
                <h2>בודקים לפני שמאחדים</h2>
                <p>
                  שמות דומים הם חשד בלבד. אין איחוד אוטומטי ואין חיבור של כמויות
                  משתתפים.
                </p>
                {pairTotal > 100 && (
                  <p>
                    מוצגים 100 מתוך {pairTotal} חשדות. לאחר טיפול ייטענו נוספים.
                  </p>
                )}
              </div>
              {pairs.map((pair) => (
                <DuplicatePair
                  key={`${pair.first.id}:${pair.second.id}`}
                  pair={pair}
                  busy={busy}
                  onDecision={decide}
                />
              ))}
              {!loading && pairs.length === 0 && (
                <div className="empty-state">
                  <Check size={32} />
                  <h3>אין כרגע חשדות לכפילות</h3>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="content-heading">
                <h2>היסטוריית פעולות הניהול</h2>
                <p>100 הפעולות האחרונות, לפי שעון ישראל</p>
              </div>
              <ul className="audit-list">
                {entries.map((entry, i) => {
                  const description = describeAudit(entry);
                  return (
                    <li key={entry.id ?? `${entry.created_at}:${i}`}>
                      <div className="audit-details">
                        <strong>{description.title}</strong>
                        {description.lines.length > 0 && (
                          <ul>
                            {description.lines.map((line, index) => (
                              <li key={index}>{line}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <time dateTime={entry.created_at}>
                        {date(entry.created_at)}
                      </time>
                    </li>
                  );
                })}
              </ul>
              {!loading && entries.length === 0 && (
                <p className="empty-state">עדיין לא בוצעו פעולות ניהול</p>
              )}
            </>
          )}
        </section>
        {data && (
          <div className="registration-settings">
            <span>
              הרשמה: <strong>{data.event.isActive ? "פתוחה" : "סגורה"}</strong>
              {data.event.registrationClosesAt &&
                ` · מועד סגירה: ${date(data.event.registrationClosesAt)}`}
            </span>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={toggleRegistration}
            >
              {data.event.isActive ? "סגירת הרשמה" : "פתיחת הרשמה"}
            </Button>
          </div>
        )}
      </main>
      <dialog
        className="editor-dialog"
        ref={editorDialog}
        onCancel={(e) => {
          if (busy) e.preventDefault();
          else setEditor(null);
        }}
      >
        <div className="dialog-heading">
          <h2>{editor === "new" ? "הוספת אישור" : "עריכת אישור"}</h2>
          <Button
            variant="ghost"
            type="button"
            disabled={busy}
            onClick={() => setEditor(null)}
          >
            סגירה
          </Button>
        </div>
        <form onSubmit={save}>
          <RsvpFields value={values} onChange={setValues} disabled={busy} />
          {editorError && (
            <p role="alert" className="message error">
              {editorError}
            </p>
          )}
          {editorError && editor !== "new" && editor && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setEditor(null);
                void load();
              }}
            >
              סגירה ורענון הרשימה
            </Button>
          )}
          <Button className="submit-button" disabled={busy}>
            {busy ? "שומרים…" : "שמירת האישור"}
          </Button>
        </form>
      </dialog>
      <dialog
        className="confirm-dialog"
        ref={confirmDialog}
        onCancel={(e) => {
          if (busy) e.preventDefault();
          else setConfirm(null);
        }}
      >
        <h2>{confirm?.title}</h2>
        <p>{confirm?.description}</p>
        <div className="toolbar">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setConfirm(null)}
          >
            ביטול
          </Button>
          <Button disabled={busy} onClick={() => void confirmed()}>
            {busy ? "מבצעים…" : "אישור הפעולה"}
          </Button>
        </div>
      </dialog>
    </div>
  );
}
function DuplicatePair({
  pair,
  busy,
  onDecision,
}: {
  pair: Pair;
  busy: boolean;
  onDecision: (
    pair: Pair,
    decision: "merge" | "not_duplicate",
    winnerId?: string,
  ) => void;
}) {
  const [winner, setWinner] = useState(pair.first.id);
  return (
    <article className="duplicate-card">
      <span className="duplicate-score">
        {pair.score === 1 ? "שם זהה" : "שם דומה"}
      </span>
      <div className="duplicate-records">
        {[pair.first, pair.second].map((r) => (
          <div key={r.id}>
            <strong>{r.full_name}</strong>
            <span>
              {attendanceLabels[r.attendance]} · {r.guest_count} משתתפים
            </span>
            <small>
              {date(r.created_at)} · {r.source === "guest" ? "אורח" : "מנהלת"}
            </small>
          </div>
        ))}
      </div>
      <label>
        האישור שיישמר באיחוד
        <select
          aria-label={`אישור לשמירה: ${pair.first.full_name}`}
          value={winner}
          disabled={busy}
          onChange={(e) => setWinner(e.target.value)}
        >
          {[pair.first, pair.second].map((r, i) => (
            <option key={r.id} value={r.id}>
              {r.full_name} · {i === 0 ? "הראשון" : "השני"} · {r.guest_count}{" "}
              משתתפים
            </option>
          ))}
        </select>
      </label>
      <div className="toolbar">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => onDecision(pair, "not_duplicate")}
        >
          לא כפול
        </Button>
        <Button
          disabled={busy}
          onClick={() => onDecision(pair, "merge", winner)}
        >
          איחוד לאחר אישור
        </Button>
      </div>
    </article>
  );
}
