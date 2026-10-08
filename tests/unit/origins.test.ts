import { expect, it } from "vitest";
import { allowedOrigins } from "../../src/lib/origins";

it("trusts only the exact preview deployment and branch origins", () => {
  const origins = allowedOrigins({
    VERCEL_ENV: "preview",
    VERCEL_URL: "rsvp-abc-team.vercel.app",
    VERCEL_BRANCH_URL: "rsvp-git-feat-team.vercel.app",
  });
  expect(origins.has("https://rsvp-abc-team.vercel.app")).toBe(true);
  expect(origins.has("https://rsvp-git-feat-team.vercel.app")).toBe(true);
  expect(origins.has("https://attacker.vercel.app")).toBe(false);
  expect(origins.has("http://rsvp-abc-team.vercel.app")).toBe(false);
});
it("requires explicit production origin and rejects malformed preview hosts", () => {
  expect(
    allowedOrigins({ VERCEL_ENV: "production", VERCEL_URL: "rsvp.vercel.app" })
      .size,
  ).toBe(0);
  expect([
    ...allowedOrigins({
      APP_ORIGIN: "https://rsvp.example",
      VERCEL_ENV: "production",
    }),
  ]).toEqual(["https://rsvp.example"]);
  expect(
    allowedOrigins({
      VERCEL_ENV: "preview",
      VERCEL_URL: "rsvp.vercel.app.evil.example",
    }).size,
  ).toBe(0);
});
