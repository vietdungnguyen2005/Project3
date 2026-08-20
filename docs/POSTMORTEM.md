# Game-day postmortem — CARD timeout

> This is a reproducible local game-day artifact, not a real customer incident.

## Summary

The CARD demo rail was switched to `TIMEOUT`. The 250 ms deadline expired, V-Pulse persisted the failed attempt, and the instruction entered the recovery queue. After the rail returned to `NORMAL`, one authorized replay produced a second `AUTHORIZED` attempt and the instruction became `SUCCEEDED`.

## Timeline

- T+00:00 — Operator injects CARD `TIMEOUT` through the BFF.
- T+00:01 — Controlled payment enters `PROCESSING`.
- T+00:01.25 — Deadline expires; attempt is recorded as `TIMEOUT`; instruction is parked.
- T+00:02 — SLO panel and parking depth show the degradation.
- T+00:04 — Operator restores `NORMAL` and verifies circuit state.
- T+00:05 — Operator replays the parked instruction; authorization succeeds.

## What worked

- The service did not hold a database transaction during the downstream wait.
- No recursive retry amplified the injected outage.
- Attempt history preserved the timeout and recovery actions.
- The BFF kept both trust credentials out of browser requests.

## Follow-up demonstrated in code

- Stalled `PROCESSING` recovery protects the crash window.
- Redis budget uses one atomic script rather than separate increment/expiry commands.
- Testcontainers makes the recovery scenario repeatable in CI.
