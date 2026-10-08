import { describe, expect, it } from "vitest";
import {
  describeAudit,
  type AuditEntry,
} from "../../src/lib/audit-description";
const record = {
  id: "first",
  full_name: "משפחת כהן",
  attendance: "yes",
  guest_count: 4,
};
const entry = (
  action: string,
  details: Record<string, unknown>,
): AuditEntry => ({
  action,
  details,
  rsvp_id: "first",
  created_at: "2026-10-08T10:00:00Z",
});
describe("useful audit history", () => {
  it("names added and deleted guests using their historical snapshots", () => {
    expect(describeAudit(entry("create", { after: record }))).toEqual({
      title: "נוסף אישור — משפחת כהן",
      lines: ["מגיעים · 4 משתתפים"],
    });
    expect(
      describeAudit({
        ...entry("archive", { before: record }),
        current_name: "שם חדש",
      }).title,
    ).toContain("משפחת כהן");
  });
  it("reports every changed field and does not list unchanged fields", () => {
    const result = describeAudit(
      entry("update", {
        before: record,
        after: {
          ...record,
          full_name: "משפחת לוי",
          attendance: "no",
          guest_count: 0,
        },
      }),
    );
    expect(result.lines).toHaveLength(3);
    expect(result.lines.join(" ")).toContain("מ־4 ל־0");
    expect(result.lines.join(" ")).toContain("לא מגיעים");
    expect(
      describeAudit(
        entry("update", {
          before: record,
          after: { ...record, guest_count: 2 },
        }),
      ).lines,
    ).toEqual(["כמות המשתתפים השתנתה מ־4 ל־2"]);
  });
  it("shows the merge winner and removed record even when both have the same name", () => {
    const other = { ...record, id: "second", guest_count: 2 };
    const result = describeAudit(
      entry("merge", {
        before: [record, other],
        winnerId: "second",
        archivedId: "first",
        countsAdded: false,
      }),
    );
    expect(result.lines).toContain("נשמר: משפחת כהן · מגיעים · 2 משתתפים");
    expect(result.lines).toContain("הוסר: משפחת כהן · מגיעים · 4 משתתפים");
    expect(result.lines).toContain("כמויות המשתתפים לא חוברו");
  });
  it("handles historical decisions, registration state and missing data without inventing counts", () => {
    const historical = {
      ...entry("not_duplicate", { firstId: "first", secondId: "second" }),
      first_current_name: "משפחת כהן",
      second_current_name: "משפחת לוי",
    };
    expect(describeAudit(historical).lines[0]).toContain("כיום");
    expect(
      describeAudit(
        entry("registration_settings", {
          isActive: false,
          registrationClosesAt: null,
        }),
      ).lines,
    ).toContain("ההרשמה נסגרה לאורחים");
    expect(describeAudit(entry("create", { after: null })).lines).toEqual([]);
  });
});
