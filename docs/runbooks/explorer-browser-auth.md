# Explorer browser authentication

Start the local service with `archctx explore start --foreground` and open the returned `data.browserUrl`. This opt-in URL uses `/connect#token=...`; the data-free bootstrap removes the fragment from history before authentication. Every request containing `?token=` is rejected, including requests with a valid Authorization header.

The bootstrap saves the token in the current tab's `sessionStorage`, which is scoped to the exact origin, including the port. It fetches the rendered page using `Authorization: Bearer <token>`, `credentials: omit` and `redirect: error`. Navigation stays on `/connect` with only non-secret view parameters; reload reads the same tab's credential. Live updates use a Bearer-authenticated fetch stream instead of EventSource query credentials. No credential appears in returned HTML, projection data, query strings, cookies or localStorage.

All protected routes accept only Bearer authentication. There is no cookie or `/session` exchange endpoint: cookies are scoped to a hostname rather than a port and would expose local credentials to sibling loopback services. A missing token or blocked browser storage stops authentication with an explicit error. Expired/rejected bootstrap authentication removes the stored credential. Revocation closes existing SSE streams; subsequent navigation is rejected. Closing the tab ends the browser session; restarting Explorer creates a new server-side session.

The service remains GET-only and architecture-read-only. Loopback peer, exact Host, and same-origin Origin checks precede every route, including `/connect`. Responses prohibit caching and send `Referrer-Policy: no-referrer`. The threat boundary covers other users, other web origins and sibling loopback ports; it does not claim protection from malicious same-origin script or hostile software controlling the browser/OS account.

## Verification

The API boundary is tested in `runtime-daemon/test/explorer-session.test.ts`; renderer navigation, stream decoding, invalidation coalescing, malformed events and disconnect behavior are tested in `explorer-html/test/runtime-script.test.ts`.

The real-browser check uses `scripts/explorer-browser-auth-smoke.ts`. Provide explicit paths to a Puppeteer module and a Chrome/Chromium executable:

```sh
bun scripts/explorer-browser-auth-smoke.ts --puppeteer-module <puppeteer-module.js> --browser <browser-executable>
```

The script launches a fresh headless profile, checks history clearing, navigation/reload, SSE invalidation, a second loopback service receiving no credential, revocation and expiry. It prints the browser version and a hash of the tested auth source. Browser dependencies belong to the verification environment; this command neither installs a browser nor changes the product's dependencies.
