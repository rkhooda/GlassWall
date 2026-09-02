# Leakage report

- Hardware: Apple M1 · 8 cores · 8 GB
- OS: Darwin 25.5.0 (arm64)
- Node: v24.20.0
- Commit: f769890
- Measured: 2026-09-02T06:06:40.964Z
- Seeds: 1337
- Policies: STRICT

# Leakage — safe build

Runs: 5 · requests scanned: 44 · canary values per seed: 17

| task | policy | seed | requests | leaks | types |
|---|---|---|---|---|---|
| T1 | STRICT | 1337 | 13 | 0 | — |
| T2 | STRICT | 1337 | 5 | 0 | — |
| T3 | STRICT | 1337 | 7 | 0 | — |
| T4 | STRICT | 1337 | 14 | 0 | — |
| T7 | STRICT | 1337 | 5 | 0 | — |

**0 leaks.**

# Leakage — UNSAFE negative control (must leak)

Runs: 1 · requests scanned: 9 · canary values per seed: 17

| task | policy | seed | requests | leaks | types |
|---|---|---|---|---|---|
| T1 | STRICT | 1337 | 9 | 6 | PERSON_NAME(raw), PHONE(raw), EMAIL(raw), STREET_ADDRESS(raw), POSTAL_CODE(raw) |

**6 leak finding(s).**
