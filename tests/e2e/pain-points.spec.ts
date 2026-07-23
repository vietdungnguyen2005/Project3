import { expect, test } from "@playwright/test";

test("100k ledger keeps mounted DOM rows bounded while scrolling", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "V-Pulse" })).toBeVisible();
  await expect(page.getByText(/from 100,000 records/)).toBeVisible({ timeout: 60_000 });

  const rows = page.locator("[data-ledger-row]");
  const mountedBefore = await rows.count();
  expect(mountedBefore).toBeGreaterThan(0);
  expect(mountedBefore).toBeLessThanOrEqual(70);

  const ledgerRegion = page.getByRole("region", { name: "Virtualized transaction ledger" });
  await ledgerRegion.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await page.waitForTimeout(400);

  const mountedAfter = await rows.count();
  const visibleIndexes = await rows.evaluateAll((elements) =>
    elements.map((element) => Number(element.getAttribute("data-index"))),
  );

  expect(mountedAfter).toBeLessThanOrEqual(70);
  expect(Math.max(...visibleIndexes)).toBeGreaterThan(99_000);
});

test("browser only calls brokered endpoints without private credentials", async ({ page }) => {
  const ledgerRequests: Array<Record<string, string>> = [];

  page.on("request", (request) => {
    const url = new URL(request.url());

    if (url.pathname === "/api/ledger") {
      ledgerRequests.push(request.headers());
    }
  });

  await page.goto("/");
  await expect(page.getByText(/Server-side brokered endpoints/)).toBeVisible();
  await expect(page.getByText(/from 100,000 records/)).toBeVisible({ timeout: 60_000 });

  expect(ledgerRequests.length).toBeGreaterThan(0);
  expect(ledgerRequests[0].authorization).toBeUndefined();
  expect(ledgerRequests[0].cookie).toBeUndefined();

  const response = await page.request.get("/api/ledger?limit=10");
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["x-powered-by"]).toBeUndefined();
});
