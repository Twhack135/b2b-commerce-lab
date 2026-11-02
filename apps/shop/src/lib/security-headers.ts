// HTTP security headers of every shop response (pages and route handlers).
// No imports, so it can be tested directly with `node --test`.
//
// The Content Security Policy follows the Next.js guide "without nonces":
// Next.js needs inline scripts for hydration, and nonces would make every
// page dynamic. A nonce-based policy is planned before the shop leaves
// local development (docs/adr/0006). HSTS and upgrade-insecure-requests
// belong to the HTTPS deployment and would break plain-HTTP localhost.

export type Header = { key: string; value: string };

export function contentSecurityPolicy(isDevelopment: boolean): string {
  return [
    "default-src 'self'",
    // 'unsafe-eval' only for React's development tools
    `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    // The browser only talks to the shop itself, never to the ERP API
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function securityHeaders(isDevelopment: boolean): Header[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(isDevelopment) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ];
}
