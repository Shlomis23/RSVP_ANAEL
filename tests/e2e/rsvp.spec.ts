import { test, expect } from "@playwright/test";
import { config } from "dotenv";
import { randomUUID } from "node:crypto";
config({ path: "work/.env.tests", quiet: true });

test("guest lifecycle, browser switching, recovery and protected management", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const suffix = randomUUID().slice(0, 7);
  const first = `בדיקת דפדפן ראשון ${suffix}`;
  const second = `בדיקת דפדפן שני ${suffix}`;
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "נשמח לדעת אם תגיעו" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.screenshot({
    path: `work/guest-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.getByLabel("שם מלא").fill(first);
  await page.getByRole("radio", { name: "מגיעים", exact: true }).check();
  await page.getByLabel("כמה תהיו?").fill("4");
  await page.getByRole("button", { name: "שליחת אישור הגעה" }).click();
  await expect(
    page.getByRole("heading", { name: "תודה, התשובה שלכם נשמרה" }),
  ).toBeVisible();
  const link = await page.getByLabel("קישור שחזור אישי").inputValue();
  await page.getByRole("button", { name: "עריכת האישור" }).click();
  await page.getByLabel("כמה תהיו?").fill("2");
  await page.getByRole("button", { name: "שמירת השינויים" }).click();
  await expect(
    page.getByText("מגיעים · 2 משתתפים", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "אישור הגעה נוסף", exact: true })
    .click();
  await expect(page.getByLabel("שם מלא")).toHaveValue("");
  await page.getByLabel("שם מלא").fill(second);
  await page.getByRole("radio", { name: "מתלבטים", exact: true }).check();
  await page.getByRole("button", { name: "שליחת אישור הגעה" }).click();
  await page.getByLabel("החלפת אישור").selectOption({ label: first });
  await expect(page.getByLabel("שם מלא")).toHaveValue(first);
  await expect(page.getByLabel("כמה תהיו?")).toHaveValue("2");
  await page.reload();
  await expect(page.getByLabel("שם מלא")).toHaveValue(first);
  const fresh = await browser.newContext();
  const recovery = await fresh.newPage();
  await recovery.goto(link);
  await expect(recovery.getByLabel("שם מלא")).toHaveValue(first);
  expect(new URL(recovery.url()).hash).toBe("");
  await recovery.getByRole("radio", { name: "לא מגיעים", exact: true }).check();
  await recovery.getByRole("button", { name: "שמירת השינויים" }).click();
  await expect(recovery.getByText("לא מגיעים", { exact: true })).toBeVisible();
  await fresh.close();
  const stranger = await browser.newContext();
  const forbidden = await stranger.request.get(`${baseURL}/api/admin/rsvps`);
  expect(forbidden.status()).toBe(401);
  await stranger.close();
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "כניסה לניהול" }),
  ).toBeVisible();
  await page.getByLabel("סיסמת ניהול").fill(process.env.TEST_ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "כניסה", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "כל מי שחוגג איתנו" }),
  ).toBeVisible();
  await page.getByLabel("חיפוש לפי שם").fill(suffix);
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await page.screenshot({
    path: `work/admin-${testInfo.project.name}.png`,
    fullPage: true,
  });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "ייצוא Excel" }).click();
  expect((await download).suggestedFilename()).toBe("anael-rsvp.xlsx");
  for (const name of [first, second]) {
    await page
      .getByRole("button", { name: `מחיקת ${name}`, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "מחיקת אישור", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "אישור הפעולה", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: `מחיקת ${name}`, exact: true }),
    ).toHaveCount(0);
  }
  await page.getByRole("button", { name: "יציאה", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "כניסה לניהול" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
