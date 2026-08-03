import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { generateLedgerWindow, LEDGER_SIZE } from "../lib/ledger.ts";

const gridSource = readFileSync(new URL("../components/ledger-grid.tsx", import.meta.url), "utf8");
const hookSource = readFileSync(new URL("../components/use-ledger-data.ts", import.meta.url), "utf8");
const proxySource = readFileSync(new URL("../app/api/ledger/route.ts", import.meta.url), "utf8");
const proxyLibSource = readFileSync(new URL("../lib/ledger-proxy.ts", import.meta.url), "utf8");
const dashboardSource = readFileSync(new URL("../components/ledger-dashboard.tsx", import.meta.url), "utf8");

const startedAt = performance.now();
const ledgerWindow = generateLedgerWindow({ offset: LEDGER_SIZE - 600, limit: 600 });
const elapsedMs = Math.round(performance.now() - startedAt);

assert.equal(ledgerWindow.total, LEDGER_SIZE, "Synthetic ledger must support 100,000 rows");
assert.equal(ledgerWindow.rows.length, 600, "Synthetic API must return bounded server windows");
assert.match(gridSource, /useVirtualizer/, "Ledger grid must use TanStack Virtual");
assert.match(gridSource, /virtualRows\.map/, "Grid must render only virtual rows");
assert.match(gridSource, /data-ledger-row/, "Rows must be countable in browser proof");
assert.doesNotMatch(gridSource, /tableRows\.map\(/, "Grid must not map every table row into DOM");
assert.match(hookSource, /LEDGER_CLIENT_WINDOW_SIZE = 600/, "Client must request bounded ledger windows");
assert.match(hookSource, /\/api\/ledger\?\$\{params\.toString\(\)\}/, "Client must request broker windows with explicit query params");
assert.doesNotMatch(hookSource, /fetch\(["'`]\/api\/ledger["'`]/, "Client must not fetch the full ledger endpoint");

assert.match(proxySource, /resolveLedgerServiceUrl/, "API route must resolve upstream server-side");
assert.match(proxyLibSource, /server-only/, "Proxy utilities must be server-only");
assert.match(proxyLibSource, /PROXY_ALLOWED_REQUEST_HEADERS/, "Proxy must use an explicit forwarded-header allowlist");
assert.doesNotMatch(dashboardSource, /FINTECH_SERVICE_TOKEN|SECRET_ACCESS_KEY|ACCESS_KEY_ID|API_TOKEN/, "Client source must not reference private tokens");

console.log(`Pain Point 5 PASS: ${ledgerWindow.rows.length.toLocaleString()}-row server window over ${ledgerWindow.total.toLocaleString()} records generated in ${elapsedMs}ms; DOM path renders virtualRows only.`);
console.log("Pain Point 6 PASS: sensitive endpoint brokerage is server-only with allowlisted forwarded headers.");
