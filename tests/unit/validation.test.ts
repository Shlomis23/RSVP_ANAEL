import { describe, expect, it } from "vitest";
import {
  createInput,
  nameSimilarity,
  normalizeName,
  rsvpInput,
  updateInput,
} from "../../src/lib/validation";
import {
  newToken,
  passwordHash,
  passwordMatches,
  tokenHash,
} from "../../src/lib/crypto";

describe("RSVP invariants", () => {
  it("requires a name, status and valid count for an attending party", () => {
    expect(
      rsvpInput.safeParse({ fullName: "א", attendance: "yes", guestCount: 4 })
        .success,
    ).toBe(false);
    expect(
      rsvpInput.safeParse({
        fullName: "ישראל ישראלי",
        attendance: "",
        guestCount: 4,
      }).success,
    ).toBe(false);
    for (const count of [0, 21, 1.5, -1])
      expect(
        rsvpInput.safeParse({
          fullName: "ישראל ישראלי",
          attendance: "yes",
          guestCount: count,
        }).success,
      ).toBe(false);
  });
  it("resets the count when changing an attending RSVP to no or maybe", () => {
    for (const status of ["no", "maybe"])
      expect(
        rsvpInput.parse({
          fullName: "ישראל ישראלי",
          attendance: status,
          guestCount: 4,
        }).guestCount,
      ).toBe(0);
  });
  it("requires an idempotency UUID and a positive version", () => {
    const value = {
      fullName: "ישראל ישראלי",
      attendance: "yes",
      guestCount: 4,
    };
    expect(createInput.safeParse({ ...value, requestKey: "bad" }).success).toBe(
      false,
    );
    expect(
      updateInput.safeParse({ ...value, expectedVersion: 0 }).success,
    ).toBe(false);
  });
  it("normalizes Hebrew niqqud and punctuation but retains a useful name", () => {
    expect(normalizeName("  עָדִי   תָּמִיר ")).toBe("עדי תמיר");
    expect(normalizeName("עדי־תמיר")).not.toBe("");
    expect(nameSimilarity("עדי תמיר", "עדי תמר")).toBeGreaterThan(0.85);
    expect(nameSimilarity("עדי תמיר", "ישראל כהן")).toBeLessThan(0.85);
  });
});
describe("credentials", () => {
  it("produces unique 256-bit tokens and stores a digest", () => {
    const first = newToken();
    expect(Buffer.from(first, "base64url")).toHaveLength(32);
    expect(first).not.toBe(newToken());
    expect(tokenHash(first)).not.toContain(first);
    expect(tokenHash(first)).toHaveLength(64);
  });
  it("uses salted password hashes and rejects invalid credentials", () => {
    const hash = passwordHash("correct horse battery staple");
    expect(passwordMatches("correct horse battery staple", hash)).toBe(true);
    expect(passwordMatches("wrong password", hash)).toBe(false);
    expect(passwordMatches("anything", "malformed")).toBe(false);
    expect(hash).not.toBe(passwordHash("correct horse battery staple"));
  });
});
