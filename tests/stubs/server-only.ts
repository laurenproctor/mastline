/**
 * A no-op stand-in for the `server-only` package.
 *
 * The real package throws when resolved outside a server context, which is
 * exactly what we want in a Next build. Vitest is neither a browser nor a Next
 * server, so it trips that guard while testing modules that are legitimately
 * server-side. Aliasing it here changes nothing about the real protection:
 * `npm run build` still fails if a client component imports a server module,
 * and tests/secret-safety.test.ts asserts the imports are in place.
 */
export {};
