import { test, expect } from "@playwright/test";

test("unauthenticated management redirects before rendering any dashboard", async ({
  page,
  request,
}) => {
  const response = await request.get("/admin", { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(response.headers().location).toBe("/admin/login");
  expect(await response.text()).not.toContain("כל מי שחוגג איתנו");
  await page.addInitScript(() => {
    const state = window as typeof window & { dashboardRendered?: boolean };
    state.dashboardRendered = false;
    new MutationObserver(() => {
      if (document.querySelector(".admin-page")) state.dashboardRendered = true;
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login$/);
  await expect(
    page.getByRole("heading", { name: "כניסה לניהול" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { dashboardRendered?: boolean })
          .dashboardRendered,
    ),
  ).toBe(false);
});
