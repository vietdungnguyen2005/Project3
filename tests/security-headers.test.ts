import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy } from "@/lib/security-headers";

describe("security headers", () => {
  it("builds a nonce-based production script policy without unsafe eval", () => {
    const policy = buildContentSecurityPolicy({
      isDevelopment: false,
      nonce: "test-nonce",
    });

    expect(policy).toContain("script-src 'self' 'nonce-test-nonce'");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(policy).toContain("frame-ancestors 'none'");
  });
});
