"""Synthetic game-day against real BFF/Java/PostgreSQL; only disposable QA containers.

Modes: scenarios, prepare-crash, crash-request, resume-crash.
The PowerShell runner owns the actual Java kill/restart, not an injected exception.
"""
import concurrent.futures
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
import urllib.error
import uuid
from datetime import datetime, timezone
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

base = os.environ["BASE_URL"]
container = os.environ["TEST_POSTGRES_CONTAINER"]
assert container.startswith("vpulse-auth-pg-")
out = Path("docs/fde/evidence")
out.mkdir(parents=True, exist_ok=True)
state = Path("backend/target/operator-browser/reconciliation-crash.json")
report = out / "game-day.json"


def sql(query):
    return subprocess.run(["docker", "exec", container, "psql", "-v", "ON_ERROR_STOP=1", "-U", "vpulse", "-d", "vpulse", "-At", "-c", query],
                          check=True, capture_output=True, text=True).stdout.strip()


def provider_calls(number):
    assert re.fullmatch(r"VP-[A-Z0-9-]+", number)
    return sql(f"SELECT COALESCE(SUM(l.authorization_calls),0) FROM simulated_provider_ledger l JOIN payment_instruction p ON l.reference LIKE 'vpulse:'||p.id||':%' WHERE p.payment_number='{number}'")


with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    try:
        context = browser.new_context(viewport={"width": 1440, "height": 1100})
        session = context.request.get(f"{base}/api/control/auth/session").json()
        login = context.request.post(f"{base}/api/control/auth/login", headers={"X-CSRF-TOKEN": session["csrfToken"]},
                                     form={"username": os.environ["TEST_OPERATOR_USERNAME"], "password": os.environ["TEST_OPERATOR_PASSWORD"]})
        assert login.status == 204, login.status
        csrf = context.request.get(f"{base}/api/control/auth/session").json()["csrfToken"]
        headers = {"X-CSRF-TOKEN": csrf}

        def get(path):
            response = context.request.get(f"{base}/api/control/{path}")
            assert response.status == 200, (path, response.status)
            return response.json()

        def post(path, body=None, status=200):
            response = context.request.post(f"{base}/api/control/{path}", headers=headers, data=body)
            assert response.status == status, (path, response.status, response.text())
            return response.json() if response.body() else None

        def fault(mode):
            post("demo/rails/CARD/fault-profile", {"failureMode": mode, "delayMs": 0})

        def lookup_mode(mode="NORMAL", delay=0):
            post("demo/rails/CARD/lookup-profile", {"mode": mode, "delayMs": delay})

        def create(merchant, mode):
            fault(mode)
            response = context.request.post(f"{base}/api/control/payments", headers=dict(headers, **{"Idempotency-Key": str(uuid.uuid4())}),
                                            data={"merchantId": merchant, "rail": "CARD", "amountMinor": 1000, "currency": "JPY"})
            assert response.status == 201, response.text()
            result = response.json()
            assert result["payment"]["status"] == "PARKED", result
            return result["payment"]["paymentNumber"]

        def capture(number, filename, expected):
            page = context.new_page()
            try:
                page.goto(base)
                page.wait_for_load_state("networkidle")
                page.get_by_text(number, exact=True).first.click()
                panel = page.get_by_role("region", name="Provider investigation")
                expect(panel.get_by_text(expected, exact=True)).to_be_visible()
                # Scroll the evidence into view in the existing drawer, not a recreated mock.
                panel.scroll_into_view_if_needed()
                page.screenshot(path=str(out / filename), full_page=True)
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "horizontal overflow"
            finally:
                page.close()

        mode = sys.argv[1] if len(sys.argv) > 1 else "scenarios"
        if mode == "scenarios":
            rows = []

            def record(scenario, number, **facts):
                rows.append(dict(scenario=scenario, payment=number, at=datetime.now(timezone.utc).isoformat(), **facts))

            lookup_mode()
            a = create("GAMEDAY-A", "ACCEPT_LOST")
            path = f"payments/{a}"
            # Authentication, CSRF and server-side operations trust must reject before lookup.
            assert context.request.post(f"{base}/api/control/{path}/reconciliation").status == 403
            anonymous = pw.request.new_context()
            try:
                assert anonymous.get(f"{base}/api/control/{path}/investigation").status == 401
                assert anonymous.post(f"{base}/api/control/{path}/reconciliation").status == 401
            finally:
                anonymous.dispose()
            page = context.new_page()
            try:
                page.goto(base); page.wait_for_load_state("networkidle")
                page.get_by_text(a, exact=True).first.click()
                page.get_by_role("button", name="Look up original operation", exact=True).click()
                confirm = page.get_by_role("button", name="Confirm verified success", exact=True)
                expect(confirm).to_be_disabled()
                page.get_by_role("checkbox").check()
                expect(confirm).to_be_enabled()
                page.screenshot(path=str(out / "accepted-lost-evidence.png"), full_page=True)
                confirm.click()
                expect(page.get_by_text("Successfully resolved — already reconciled.", exact=False)).to_be_visible()
                page.screenshot(path=str(out / "resolved-success.png"), full_page=True)
            finally:
                page.close()
            observed = post(f"{path}/reconciliation")
            assert observed["state"] == "RESOLVED"
            post(f"{path}/reconciliation/{observed['id']}/resolve")
            assert get(path)["payment"]["status"] == "SUCCEEDED" and provider_calls(a) == "1"
            record("A accepted / response lost", a, state="SUCCEEDED", providerCalls=1, repeatedResolution="same evidence")

            b = create("GAMEDAY-B", "REJECT")
            ev = post(f"payments/{b}/reconciliation")
            assert ev["outcome"] == "VERIFIED_REJECTION"
            post(f"parking/{b}/replay", status=409)
            capture(b, "verified-rejection.png", "CONFIRM_REJECTION")
            post(f"payments/{b}/reconciliation/{ev['id']}/resolve")
            assert get(f"payments/{b}/investigation")["nextAction"] == "CONTROLLED_REPLAY_ALLOWED"
            assert provider_calls(b) == "1"
            fault("NORMAL")
            replay = post(f"parking/{b}/replay")
            assert replay["payment"]["status"] == "SUCCEEDED" and provider_calls(b) == "2"
            record("B final rejection", b, state="SUCCEEDED", providerCalls=2, priorAttempt="REJECTED / no execution", replay="separate explicit operation")

            c = create("GAMEDAY-C", "TIMEOUT")
            for lookup, outcome in [("NORMAL", "UNKNOWN"), ("UNAVAILABLE", "PROVIDER_UNAVAILABLE")]:
                lookup_mode(lookup)
                started = time.monotonic()
                ev = post(f"payments/{c}/reconciliation")
                elapsed = time.monotonic() - started
                assert ev["outcome"] == outcome and elapsed < 5
                post(f"payments/{c}/reconciliation/{ev['id']}/resolve", status=409)
                post(f"parking/{c}/replay", status=409)
                assert get(f"payments/{c}")["payment"]["status"] == "PARKED"
                capture(c, f"{outcome.lower()}.png", "RECONCILE_PROVIDER")
                record(f"C {outcome}", c, state="PARKED", providerCalls=int(provider_calls(c)), lookupSeconds=round(elapsed, 3), replayStatus=409)
            lookup_mode()
            # Explicit test-only missing record; NOT_FOUND is never a retry guarantee.
            sql(f"DELETE FROM simulated_provider_ledger WHERE reference=(SELECT provider_reference FROM payment_instruction WHERE payment_number='{c}')")
            ev = post(f"payments/{c}/reconciliation")
            assert ev["outcome"] == "NOT_FOUND"
            post(f"parking/{c}/replay", status=409)
            record("C NOT_FOUND", c, state="PARKED", injection="removed only synthetic ledger record", replayStatus=409)

            d = create("GAMEDAY-D", "ACCEPT_LOST")
            lookup_mode("NORMAL", 200)
            cookie = "; ".join(f"{entry['name']}={entry['value']}" for entry in context.cookies())

            def concurrent_post(path):
                request = urllib.request.Request(f"{base}/api/control/{path}", method="POST", headers={"Cookie": cookie, "X-CSRF-TOKEN": csrf})
                with urllib.request.urlopen(request, timeout=15) as response:
                    return response.status, json.loads(response.read())

            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                futures = [pool.submit(concurrent_post, f"payments/{d}/reconciliation") for _ in range(2)]
                results = [item.result() for item in futures]
                assert results[0][1]["id"] == results[1][1]["id"]
                run = results[0][1]["id"]
                decisions = [pool.submit(concurrent_post, f"payments/{d}/reconciliation/{run}/resolve") for _ in range(2)]
                assert all(item.result()[1]["state"] == "RESOLVED" for item in decisions)
            assert provider_calls(d) == "1"
            assert sql(f"SELECT COUNT(*) FROM audit_event WHERE aggregate_id='{d}' AND action='RECONCILIATION_RESOLVED'") == "1"
            record("D concurrent operators", d, state="SUCCEEDED", providerCalls=1, resolvedAudits=1, lookupHttpStatuses=[item[0] for item in results])
            lookup_mode()
            report.write_text(json.dumps(dict(simulation=True, environment="local disposable PostgreSQL/Redis + Java + Next", scenarios=rows), indent=2), encoding="utf-8")
            print("PASS: A-D, real browser confirmation, unknown/unavailable/not-found, protected API, concurrent claims and resolutions")

        elif mode == "prepare-crash":
            lookup_mode()
            number = create("GAMEDAY-E", "ACCEPT_LOST")
            lookup_mode("NORMAL", 5000)
            state.write_text(json.dumps(dict(payment=number, preparedAt=datetime.now(timezone.utc).isoformat())), encoding="utf-8")
            print("Prepared synthetic crash lookup")
        elif mode == "crash-request":
            number = json.loads(state.read_text(encoding="utf-8"))["payment"]
            try:
                post(f"payments/{number}/reconciliation")
                raise AssertionError("Expected the owned Java process to be terminated during the lookup")
            except AssertionError as error:
                # BFF returns a safe 503 when its upstream process is killed.
                assert "503" in str(error), str(error)
                print("Observed 503 after actual Java process termination")
        elif mode == "resume-crash":
            saved = json.loads(state.read_text(encoding="utf-8")); number = saved["payment"]
            assert re.fullmatch(r"VP-[A-Z0-9-]+", number)
            before = get(f"payments/{number}/investigation")
            assert before["detail"]["payment"]["status"] == "PARKED"
            assert before["evidence"][0]["state"] == "IN_PROGRESS"
            # Accelerate lease expiry in the disposable DB; this is NOT a measured recovery SLA.
            sql(f"UPDATE payment_reconciliation SET lease_until=clock_timestamp()-INTERVAL '1 second' WHERE payment_id=(SELECT id FROM payment_instruction WHERE payment_number='{number}') AND state='IN_PROGRESS'")
            lookup_mode()
            ev = post(f"payments/{number}/reconciliation")
            assert ev["outcome"] == "VERIFIED_SUCCESS"
            current = get(f"payments/{number}/investigation")
            assert any(item["state"] == "INTERRUPTED" for item in current["evidence"])
            post(f"payments/{number}/reconciliation/{ev['id']}/resolve")
            assert provider_calls(number) == "1"
            capture(number, "crash-recovered.png", "ALREADY_RECONCILED")
            result = json.loads(report.read_text(encoding="utf-8"))
            result["scenarios"].append(dict(scenario="E actual process kill / restart", payment=number, at=datetime.now(timezone.utc).isoformat(),
                                            preparedAt=saved["preparedAt"], state="SUCCEEDED", providerCalls=1, previousClaim="INTERRUPTED", leaseExpiry="accelerated in disposable DB; not SLA"))
            report.write_text(json.dumps(result, indent=2), encoding="utf-8")
            print("PASS: E actual Java kill while IN_PROGRESS, durable claim after restart, interrupted evidence retained, resolution without authorization")
        else:
            raise ValueError("Unknown QA phase")
    finally:
        browser.close()
