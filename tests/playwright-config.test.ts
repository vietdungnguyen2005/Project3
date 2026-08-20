import { describe, expect, it } from "vitest";
import config from "../playwright.config";

describe("Playwright local server configuration", () => {
  it("uses the portable local port selected for Windows and CI development", () => {
    expect(config.use?.baseURL).toBe("http://127.0.0.1:3207");
    expect(config.webServer).toMatchObject({ url: "http://127.0.0.1:3207" });
  });
});
