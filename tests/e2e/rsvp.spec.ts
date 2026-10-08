import { test, expect } from "@playwright/test";
import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
config({ path: ".env.local", quiet: true });
if (!process.env.NEON_BRANCH || process.env.NEON_BRANCH === "production")
  throw new Error("Guest browser tests require a development branch");
async function cleanup(ids: string[]) {
  const url = new URL(process.env.DATABASE_URL_UNPOOLED!);
  url.searchParams.delete("sslmode");
  url.searchParams.delete("channel_binding");
  const db = new Client({
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true },
  });
  await db.connect();
  try {
    await db.query("delete from rsvps where id=any($1::uuid[])", [ids]);
  } finally {
    await db.end();
  }
}

test("single approval survives reload and stale tabs cannot create another", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const ids: string[] = [];
  const name = `בדיקת דפדפן ${randomUUID().slice(0, 7)}`;
  try {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "נשמח לדעת אם תגיעו" }),
    ).toBeVisible();
    const stale = await context.newPage();
    await stale.goto("/");
    await expect(stale.getByLabel("שם מלא")).toBeVisible();
    await page.getByLabel("שם מלא").fill(name);
    await page.getByRole("radio", { name: "מגיעים", exact: true }).check();
    await page.getByLabel("כמה תהיו?").fill("4");
    await page.getByRole("button", { name: "שליחת אישור הגעה" }).click();
    await expect(
      page.getByRole("heading", { name: "תודה, התשובה שלכם נשמרה" }),
    ).toBeVisible();
    const mine = (await (await page.request.get("/api/rsvps/mine")).json())
      .rsvps;
    ids.push(...mine.map((r: { id: string }) => r.id));
    expect(mine).toHaveLength(1);
    await expect(
      page.getByRole("button", { name: /אישור הגעה נוסף|קישור שחזור/ }),
    ).toHaveCount(0);
    await expect(page.getByLabel("קישור שחזור אישי")).toHaveCount(0);
    await stale.getByLabel("שם מלא").fill(name + " נוסף");
    await stale.getByRole("radio", { name: "מגיעים", exact: true }).check();
    await stale.getByRole("button", { name: "שליחת אישור הגעה" }).click();
    await expect(stale.getByLabel("שם מלא")).toHaveValue(name);
    await expect(
      stale.getByRole("heading", { name: "מעדכנים את האישור שלכם" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "עריכת האישור" }).click();
    await page.getByLabel("כמה תהיו?").fill("2");
    await page.getByRole("button", { name: "שמירת השינויים" }).click();
    await expect(
      page.getByText("מגיעים · 2 משתתפים", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("שם מלא")).toHaveValue(name);
    await expect(page.getByLabel("כמה תהיו?")).toHaveValue("2");
    expect(
      (await (await page.request.get("/api/rsvps/mine")).json()).rsvps,
    ).toHaveLength(1);
    const other = await browser.newContext();
    expect(
      (await other.request.get(`${baseURL}/api/rsvps/${ids[0]}`)).status(),
    ).toBe(401);
    await other.close();
  } finally {
    await cleanup(ids);
  }
});

test("a lost save response can be retried without another approval or recovery controls", async ({
  page,
}) => {
  const ids: string[] = [];
  let first = true;
  try {
    await page.goto("/");
    await expect(page.getByLabel("שם מלא")).toBeVisible();
    await page.route("**/api/rsvps", async (route) => {
      if (first && route.request().method() === "POST") {
        first = false;
        const response = await route.fetch();
        const data = await response.json();
        ids.push(data.rsvp.id);
        expect(data).not.toHaveProperty("recoveryUrl");
        await route.abort("failed");
      } else await route.continue();
    });
    await page
      .getByLabel("שם מלא")
      .fill(`בדיקת שליחה ${randomUUID().slice(0, 7)}`);
    await page.getByRole("radio", { name: "מגיעים", exact: true }).check();
    await page.getByRole("button", { name: "שליחת אישור הגעה" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await page.getByRole("button", { name: "שליחת אישור הגעה" }).click();
    await expect(
      page.getByRole("heading", { name: "תודה, התשובה שלכם נשמרה" }),
    ).toBeVisible();
    const mine = (await (await page.request.get("/api/rsvps/mine")).json())
      .rsvps;
    expect(mine.map((r: { id: string }) => r.id)).toEqual(ids);
    await expect(
      page.getByRole("button", { name: /אישור הגעה נוסף|קישור שחזור/ }),
    ).toHaveCount(0);
  } finally {
    await cleanup(ids);
  }
});
