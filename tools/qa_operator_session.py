"""Real BFF + Spring + PostgreSQL browser smoke; no network fixtures."""
import os
import subprocess
import uuid
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

base = os.environ["BASE_URL"]
output = Path("backend/target/operator-browser")
output.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    try:
        context = browser.new_context(viewport={"width": 1440, "height": 1000})
        page = context.new_page()
        page.goto(base)
        page.wait_for_load_state("networkidle")
        print("Rendered headings:", page.get_by_role("heading").all_text_contents())
        page.screenshot(path=str(output / "public-read-only.png"), full_page=True)
        expect(page.get_by_role("heading", name="V-Pulse / Ops")).to_be_visible()
        expect(page.get_by_role("button", name="Process payment")).to_be_disabled()
        assert context.request.get(f"{base}/api/control/payments").status == 200
        assert context.request.post(f"{base}/api/control/payments", data={}).status == 401
        page.get_by_text("Operator sign-in", exact=True).click()
        page.get_by_label("Username", exact=True).fill(os.environ["TEST_OPERATOR_USERNAME"])
        page.get_by_label("Password", exact=True).fill(os.environ["TEST_OPERATOR_PASSWORD"])
        with page.expect_response(lambda r: r.url.endswith("/auth/login")) as login:
            page.get_by_role("button", name="Sign in", exact=True).click()
        assert login.value.status == 204
        expect(page.get_by_role("button", name="Sign out")).to_be_visible()
        expect(page.get_by_role("button", name="Process payment")).to_be_enabled()
        cookies = context.cookies()
        session = next(c for c in cookies if c["name"] == "VPULSE_SESSION")
        assert session["httpOnly"] and session["sameSite"] == "Lax"
        assert context.request.post(f"{base}/api/control/payments", data={}).status == 403
        with page.expect_response(lambda r: r.url.endswith("/control/payments") and r.request.method == "POST") as payment:
            page.get_by_role("button", name="Process payment").click()
        assert payment.value.status == 201
        page.screenshot(path=str(output / "operator-session.png"), full_page=True)
        committed = {}

        def commit_then_drop(route):
            response = route.fetch()
            assert response.status == 201
            committed.update(body=response.json(), key=route.request.headers["idempotency-key"])
            route.abort("failed")

        page.route(f"{base}/api/control/payments", commit_then_drop)
        page.get_by_role("button", name="Process payment").click()
        expect(page.get_by_text("The payment response is unconfirmed.", exact=False)).to_be_visible()
        pending = page.evaluate("JSON.parse(sessionStorage.getItem('vpulse:payment-create:v1'))")
        assert pending["key"] == committed["key"]
        page.unroute(f"{base}/api/control/payments", commit_then_drop)
        page.reload(wait_until="networkidle")
        expect(page.get_by_role("button", name="Process payment")).to_be_enabled()
        assert page.evaluate("JSON.parse(sessionStorage.getItem('vpulse:payment-create:v1')).key") == committed["key"]
        with page.expect_response(lambda r: r.url.endswith("/control/payments") and r.request.method == "POST") as recovered:
            page.get_by_role("button", name="Process payment").click()
        assert recovered.value.status == 200 and recovered.value.json() == committed["body"]
        assert recovered.value.request.headers["idempotency-key"] == committed["key"]
        expect(page.get_by_role("button", name="Process payment")).to_be_enabled()
        assert page.evaluate("sessionStorage.getItem('vpulse:payment-create:v1')") is None
        container = os.environ["TEST_POSTGRES_CONTAINER"]
        assert container.startswith("vpulse-auth-pg-")
        number = committed["body"]["payment"]["paymentNumber"]
        assert number.startswith("VP-") and number[3:].isalnum()
        sql = f"SELECT (SELECT COUNT(*) FROM payment_instruction WHERE payment_number='{number}'),(SELECT COUNT(*) FROM payment_create_operation o JOIN payment_instruction p ON p.id=o.payment_id WHERE p.payment_number='{number}'),(SELECT COUNT(*) FROM payment_attempt a JOIN payment_instruction p ON p.id=a.payment_id WHERE p.payment_number='{number}');"
        counts = subprocess.run(["docker", "exec", container, "psql", "-U", "vpulse", "-d", "vpulse", "-At", "-c", sql], check=True, capture_output=True, text=True).stdout.strip()
        assert counts == "1|1|1"
        print("PASS: real Java simulator response committed then browser delivery aborted; reload reused key, duplicate 200, one instruction/identity/attempt")
        csrf = context.request.get(f"{base}/api/control/auth/session").json()["csrfToken"]
        mutation_headers = {"X-CSRF-TOKEN": csrf}

        def set_fault(mode):
            changed = context.request.post(f"{base}/api/control/demo/rails/CARD/fault-profile",
                                           headers=mutation_headers, data={"failureMode": mode, "delayMs": 0})
            assert changed.status == 200

        def create_faulted(merchant):
            created = context.request.post(f"{base}/api/control/payments",
                headers=dict(mutation_headers, **{"Idempotency-Key": str(uuid.uuid4())}),
                data={"merchantId": merchant, "rail": "CARD", "amountMinor": 1000, "currency": "JPY"})
            assert created.status == 201
            return created.json()

        set_fault("TIMEOUT")
        unknown = create_faulted("QA-UNKNOWN-REPLAY")
        assert unknown["parkedReason"] == "TIMEOUT"
        set_fault("NORMAL")
        unknown_number = unknown["payment"]["paymentNumber"]
        rejected_replay = context.request.post(f"{base}/api/control/parking/{unknown_number}/replay", headers=mutation_headers)
        assert rejected_replay.status == 409 and rejected_replay.json()["code"] == "PAYMENT_RECONCILIATION_REQUIRED"
        after_unknown = context.request.get(f"{base}/api/control/payments/{unknown_number}").json()
        assert after_unknown["payment"]["status"] == "PARKED" and len(after_unknown["attempts"]) == 1
        set_fault("REJECT")
        rejected = create_faulted("QA-DEFINITIVE-REJECT")
        assert rejected["parkedReason"] == "DOWNSTREAM_REJECTED"
        set_fault("NORMAL")
        replayed = context.request.post(f"{base}/api/control/parking/{rejected['payment']['paymentNumber']}/replay", headers=mutation_headers)
        assert replayed.status == 200 and replayed.json()["payment"]["status"] == "SUCCEEDED"
        assert len(replayed.json()["attempts"]) == 2
        print("PASS: real BFF/Java TIMEOUT -> healthy rail still refuses authorization replay (409, one attempt); definitive REJECT -> healthy rail controlled replay succeeds")
        with page.expect_response(lambda r: r.url.endswith("/auth/logout")) as logout:
            page.get_by_role("button", name="Sign out").click()
        assert logout.value.status == 204
        expect(page.get_by_role("button", name="Process payment")).to_be_disabled()
        assert context.request.post(f"{base}/api/control/payments", data={}).status == 401
        assert context.request.get(f"{base}/api/control/payments").status == 200
        print("PASS: public read-only, anonymous 401, real login, HttpOnly cookie, CSRF 403, payment 201, logout.")
    finally:
        browser.close()
