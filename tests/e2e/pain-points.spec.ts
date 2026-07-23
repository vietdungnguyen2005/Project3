import { expect, test } from "@playwright/test";

test("100k ledger keeps mounted DOM rows bounded while scrolling", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "V-Pulse" })).toBeVisible();
  await expect(page.getByText(/Synthetic demo mode/)).toBeVisible();
  await expect(page.getByText(/from 100,000 records/)).toBeVisible({ timeout: 60_000 });

  await expect(page.getByRole("grid", { name: "Virtualized transaction ledger" })).toBeVisible();

  const rows = page.locator("[data-ledger-row]");
  const mountedBefore = await rows.count();
  expect(mountedBefore).toBeGreaterThan(0);
  expect(mountedBefore).toBeLessThanOrEqual(70);

  const ledgerViewport = page.locator("[data-ledger-viewport]");
  await ledgerViewport.evaluate((element) => {
    element.scrollTo(0, element.scrollHeight);
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });

  await expect
    .poll(
      async () => {
        const visibleIndexes = await rows.evaluateAll((elements) =>
          elements.map((element) => Number(element.getAttribute("data-index"))),
        );

        return Math.max(...visibleIndexes);
      },
      { timeout: 10_000 },
    )
    .toBeGreaterThan(99_000);

  const mountedAfter = await rows.count();
  expect(mountedAfter).toBeLessThanOrEqual(70);
});

test("browser only calls brokered endpoints without private credentials", async ({ page }) => {
  const ledgerRequestPromise = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/ledger");

  await page.goto("/");
  const ledgerRequest = await ledgerRequestPromise;
  const ledgerUrl = new URL(ledgerRequest.url());
  const ledgerHeaders = ledgerRequest.headers();

  await expect(page.getByText(/Server-side brokered endpoints/)).toBeVisible();
  await expect(page.getByText(/from 100,000 records/)).toBeVisible({ timeout: 60_000 });

  expect(ledgerHeaders.authorization).toBeUndefined();
  expect(ledgerHeaders.cookie).toBeUndefined();
  expect(Number(ledgerUrl.searchParams.get("limit"))).toBeGreaterThan(0);
  expect(Number(ledgerUrl.searchParams.get("limit"))).toBeLessThanOrEqual(1_500);
  expect(Number(ledgerUrl.searchParams.get("offset"))).toBe(0);

  const response = await page.request.get("/api/ledger?limit=10");
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["x-powered-by"]).toBeUndefined();

  const csp = response.headers()["content-security-policy"];
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("script-src 'self' 'nonce-");

  if (process.env.PLAYWRIGHT_BASE_URL) {
    expect(csp).not.toContain("'unsafe-eval'");
  }
});
