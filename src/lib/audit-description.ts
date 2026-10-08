import { attendanceLabels } from "./event";

export type AuditEntry = {
  id?: string;
  action: string;
  rsvp_id: string | null;
  created_at: string;
  details: Record<string, unknown>;
  current_name?: string | null;
  first_current_name?: string | null;
  second_current_name?: string | null;
};
type Snapshot = {
  id?: string;
  full_name?: string;
  attendance?: string;
  guest_count?: number;
};
function snapshot(value: unknown): Snapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return {
    id: typeof record.id === "string" ? record.id : undefined,
    full_name:
      typeof record.full_name === "string" ? record.full_name : undefined,
    attendance:
      typeof record.attendance === "string" ? record.attendance : undefined,
    guest_count:
      typeof record.guest_count === "number" &&
      Number.isInteger(record.guest_count) &&
      record.guest_count >= 0
        ? record.guest_count
        : undefined,
  };
}
function status(value: string | undefined) {
  return value && Object.hasOwn(attendanceLabels, value)
    ? attendanceLabels[value as keyof typeof attendanceLabels]
    : undefined;
}
function summary(record: Snapshot | null) {
  if (!record) return "";
  return [
    status(record.attendance),
    record.guest_count === undefined
      ? undefined
      : `${record.guest_count} משתתפים`,
  ]
    .filter(Boolean)
    .join(" · ");
}
export function describeAudit(entry: AuditEntry): {
  title: string;
  lines: string[];
} {
  const d = entry.details;
  const before = snapshot(d.before);
  const after = snapshot(d.after);
  const name = after?.full_name || before?.full_name || entry.current_name;
  const named = (title: string) => (name ? `${title} — ${name}` : title);
  if (entry.action === "create")
    return {
      title: named("נוסף אישור"),
      lines: summary(after) ? [summary(after)] : [],
    };
  if (entry.action === "archive")
    return {
      title: named("נמחק אישור"),
      lines: summary(before) ? [`לפני המחיקה: ${summary(before)}`] : [],
    };
  if (entry.action === "update") {
    const lines: string[] = [];
    if (before && after) {
      if (
        before.full_name &&
        after.full_name &&
        before.full_name !== after.full_name
      )
        lines.push(`השם שונה מ״${before.full_name}״ ל״${after.full_name}״`);
      const oldStatus = status(before.attendance),
        newStatus = status(after.attendance);
      if (oldStatus && newStatus && before.attendance !== after.attendance)
        lines.push(`הסטטוס השתנה מ״${oldStatus}״ ל״${newStatus}״`);
      if (
        before.guest_count !== undefined &&
        after.guest_count !== undefined &&
        before.guest_count !== after.guest_count
      )
        lines.push(
          `כמות המשתתפים השתנתה מ־${before.guest_count} ל־${after.guest_count}`,
        );
    }
    if (!lines.length && summary(after))
      lines.push(`לאחר השמירה: ${summary(after)}`);
    return { title: named("נערך אישור"), lines };
  }
  if (entry.action === "merge" || entry.action === "not_duplicate") {
    const records = Array.isArray(d.before)
      ? d.before.map(snapshot).filter((r): r is Snapshot => Boolean(r))
      : [];
    const first = records[0],
      second = records[1];
    const firstName = first?.full_name,
      secondName = second?.full_name;
    if (entry.action === "not_duplicate") {
      if (firstName && secondName)
        return {
          title: "אישורים סומנו כנפרדים",
          lines: [`״${firstName}״ ו״${secondName}״ אינם כפולים`],
        };
      const names = [
        entry.first_current_name,
        entry.second_current_name,
      ].filter(Boolean);
      return {
        title: "אישורים סומנו כנפרדים",
        lines: names.length
          ? [`האישורים מופיעים כיום בשמות: ${names.join(" ו־")}`]
          : [],
      };
    }
    const winner = records.find((r) => r.id === d.winnerId);
    const loser = records.find((r) => r.id === d.archivedId);
    const lines: string[] = [];
    for (const record of records)
      if (record.full_name)
        lines.push(
          `לפני האיחוד: ${record.full_name}${summary(record) ? ` · ${summary(record)}` : ""}`,
        );
    if (winner?.full_name)
      lines.push(
        `נשמר: ${winner.full_name}${summary(winner) ? ` · ${summary(winner)}` : ""}`,
      );
    if (loser?.full_name)
      lines.push(
        `הוסר: ${loser.full_name}${summary(loser) ? ` · ${summary(loser)}` : ""}`,
      );
    if (d.countsAdded === false) lines.push("כמויות המשתתפים לא חוברו");
    return {
      title:
        firstName && secondName
          ? `אוחדו האישורים של ״${firstName}״ ו״${secondName}״`
          : "אוחדו שני אישורים",
      lines,
    };
  }
  if (entry.action === "registration_settings") {
    const lines: string[] = [];
    if (typeof d.isActive === "boolean")
      lines.push(d.isActive ? "ההרשמה נפתחה לאורחים" : "ההרשמה נסגרה לאורחים");
    if (typeof d.registrationClosesAt === "string") {
      const closes = new Date(d.registrationClosesAt);
      if (!Number.isNaN(closes.getTime()))
        lines.push(
          `מועד הסגירה שנקבע: ${new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "short", timeStyle: "short" }).format(closes)}`,
        );
    } else if (d.registrationClosesAt === null)
      lines.push("לא הוגדר מועד סגירה אוטומטי");
    return { title: "עודכנו הגדרות ההרשמה", lines };
  }
  return { title: "פעולת ניהול", lines: [] };
}
