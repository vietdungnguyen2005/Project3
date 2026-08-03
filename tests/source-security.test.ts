import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const privatePatterns = [
  "FINTECH_SERVICE_TOKEN",
  "API_TOKEN",
  "SECRET_ACCESS_KEY",
  "ACCESS_KEY_ID",
  "S3_API_ENDPOINT",
  "CLOUDFLARE_API_TOKEN",
];

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const absolutePath = path.join(directory, entry);
    const stats = statSync(absolutePath);

    if (stats.isDirectory()) {
      if (absolutePath.includes(`${path.sep}api${path.sep}`)) {
        return [];
      }

      return collectSourceFiles(absolutePath);
    }

    return /\.(ts|tsx)$/.test(entry) ? [absolutePath] : [];
  });
}

describe("client source security", () => {
  it("does not reference private deployment or fintech token names outside server routes", () => {
    const files = [...collectSourceFiles(path.resolve("app")), ...collectSourceFiles(path.resolve("components"))];

    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const source = readFileSync(file, "utf8");

      for (const pattern of privatePatterns) {
        expect(source, `${pattern} leaked in ${file}`).not.toContain(pattern);
      }
    }
  });
});
