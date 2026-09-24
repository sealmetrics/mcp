# Page-level simulation fixtures (PRD-058 F3)

Pages that `setup-core/test/page.test.ts` drives through `simulatePage` in a real
browser. `good.html` is a correct install; each other page breaks it in one way the
call-level simulation cannot see. The tracker URL points at production, but the
simulator serves the vendored tracker for it and answers every `/event` locally.

| Page | Break | Caught by |
|---|---|---|
| `good.html` | none | all checks pass |
| `no-stub.html` | `conv()` inline right after a `defer` tracker, no stub | SP-04 console error, SP-05 no hit |
| `csp.html` | CSP `script-src 'self'` | SP-02 tracker not loaded, SP-03 CSP |
| `double-spa.html` | manual `sealmetrics()` on a pushState navigation, with SPA tracking on (the default) | SP-06 pageviews counted twice |
| `duplicate.html` | the tracker tag twice | SP-01 two tags, SP-06 two pageviews |
| `own-event.html` | the site's own `POST /api/event` | not captured, not counted |

Serve with `make test-site` (http://localhost:8888/sim/…) to open them by hand.
