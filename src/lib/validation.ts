import { z } from "zod";

export function normalizeName(name: string) {
  return name
    .normalize("NFKC")
    .replace(/[\u0591-\u05BD\u05BF-\u05C7]/g, "")
    .replace(/[׳״'".,\-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
export const rsvpInput = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(2)
      .max(100)
      .refine((v) => normalizeName(v).length >= 2),
    attendance: z.enum(["yes", "no", "maybe"]),
    guestCount: z.number().int().min(0).max(20),
  })
  .superRefine((value, ctx) => {
    if (value.attendance === "yes" && value.guestCount < 1) {
      ctx.addIssue({
        code: "custom",
        path: ["guestCount"],
        message: "יש לבחור בין 1 ל־20 משתתפים",
      });
    }
  })
  .transform((value) => ({
    ...value,
    guestCount: value.attendance === "yes" ? value.guestCount : 0,
  }));

export const createInput = z
  .object({
    fullName: z.string(),
    attendance: z.enum(["yes", "no", "maybe"]),
    guestCount: z.number(),
    requestKey: z.uuid(),
  })
  .transform((v, ctx) => {
    const parsed = rsvpInput.safeParse(v);
    if (!parsed.success) {
      parsed.error.issues.forEach((issue) =>
        ctx.addIssue({
          code: "custom",
          path: issue.path,
          message: issue.message,
        }),
      );
      return z.NEVER;
    }
    return { ...parsed.data, requestKey: v.requestKey };
  });
export const updateInput = z
  .object({
    fullName: z.string(),
    attendance: z.enum(["yes", "no", "maybe"]),
    guestCount: z.number(),
    expectedVersion: z.number().int().positive(),
  })
  .transform((v, ctx) => {
    const parsed = rsvpInput.safeParse(v);
    if (!parsed.success) {
      parsed.error.issues.forEach((issue) =>
        ctx.addIssue({
          code: "custom",
          path: issue.path,
          message: issue.message,
        }),
      );
      return z.NEVER;
    }
    return { ...parsed.data, expectedVersion: v.expectedVersion };
  });
export const idInput = z.uuid();

// Suggestions only: never use a name match to authorize access or merge automatically.
export function nameSimilarity(a: string, b: string) {
  a = normalizeName(a);
  b = normalizeName(b);
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = old;
    }
  }
  return 1 - row[b.length] / Math.max(a.length, b.length);
}
