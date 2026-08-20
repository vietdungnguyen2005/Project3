import { expect, test, type Page } from "@playwright/test";

const rails = [
  { rail: "ZENGIN", displayName: "Zengin domestic transfer", failureMode: "NORMAL", simulatedDelayMs: 35, circuitState: "CLOSED", bufferedCalls: 4, updatedAt: "2026-08-10T00:00:00Z" },
  { rail: "CARD", displayName: "Card authorization", failureMode: "TIMEOUT", simulatedDelayMs: 0, circuitState: "OPEN", bufferedCalls: 4, updatedAt: "2026-08-10T00:00:00Z" },
  { rail: "SWIFT", displayName: "SWIFT international", failureMode: "NORMAL", simulatedDelayMs: 35, circuitState: "CLOSED", bufferedCalls: 2, updatedAt: "2026-08-10T00:00:00Z" },
];

const parked = { paymentNumber: "VP-00000011", merchantId: "MERCHANT-012", rail: "CARD", amountMinor: 11507, currency: "JPY", status: "PARKED", createdAt: "2026-08-10T00:00:00Z" };
const succeeded = { ...parked, paymentNumber: "VP-00000012", status: "SUCCEEDED", rail: "ZENGIN" };

async function mockControlPlane(page: Page) {
  await page.route("**/api/control/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (path.endsWith("/reliability/overview")) body = { throughput: 1000, succeeded: 908, processing: 1, parked: 91, successRate: 90.8, oldestParkedSeconds: 660, rails };
    else if (path.endsWith("/payments")) body = { rows: [parked, succeeded], total: 1000, offset: 0, limit: 200 };
    else if (path.endsWith("/parking")) body = [parked];
    else if (path.endsWith(parked.paymentNumber)) body = { payment: parked, parkedReason: "TIMEOUT", attempts: [{ attemptNumber: 1, outcome: "TIMEOUT", latencyMs: 251, detail: "Request parked for safe operator recovery", createdAt: parked.createdAt }] };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
}

test.beforeEach(async ({ page }) => {
  await mockControlPlane(page);
});

test("operator can see the breach, failure containment, and recovery evidence", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  await expect(page.getByRole("heading", { name: "V-Pulse / Ops" })).toBeVisible();
  await expect(page.getByText("SLO BREACH")).toBeVisible();
  await expect(page.getByText("91", { exact: true })).toBeVisible();
  await expect(page.getByText("OPEN", { exact: true })).toBeVisible();
  await expect(page.getByText(parked.paymentNumber).first()).toBeVisible();

  await page.getByText(parked.paymentNumber).first().click();
  await expect(page.getByRole("complementary", { name: "Payment details" })).toContainText("TIMEOUT");
  await expect(page.getByRole("complementary", { name: "Payment details" })).toContainText("251ms");
  if ((page.viewportSize()?.width ?? 0) > 1000) {
    await page.getByRole("button", { name: "Close payment details" }).click();
    await page.screenshot({ path: "docs/evidence/control-plane.png", fullPage: true });
  }
});

test("browser mutations use the BFF path without privileged headers", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const requestPromise = page.waitForRequest((request) => request.url().includes("/fault-profile") && request.method() === "POST");
  await page.getByRole("button", { name: "REJECT" }).first().click();
  const request = await requestPromise;

  expect(request.headers()["x-v-pulse-bff-secret"]).toBeUndefined();
  expect(request.headers()["x-v-pulse-ops-secret"]).toBeUndefined();
  expect(new URL(request.url()).pathname).toBe("/api/control/demo/rails/ZENGIN/fault-profile");
});
