// Request-derived URLs.
//
// The app runs behind a proxy in preview deployments and directly on a LAN in
// local use. Neither should produce a redirect to `0.0.0.0`, and a cookie must
// only be marked Secure when the browser actually reached us over HTTPS — a
// Secure cookie over plain HTTP is silently discarded, which looks exactly like
// "login does nothing".

export interface RequestLike {
  url: string;
  headers: Headers;
}

function firstHeaderValue(value: string | null): string | null {
  if (!value) return null;
  const first = value.split(',')[0]?.trim();
  return first ? first : null;
}

function isSafeHost(host: string): boolean {
  // Host header is attacker-influenced; only accept a hostname[:port] shape.
  return /^[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(host);
}

/** Absolute origin the client actually used, preferring proxy headers. */
export function publicOrigin(request: RequestLike): string {
  const forwardedProto = firstHeaderValue(request.headers.get('x-forwarded-proto'));
  const forwardedHost = firstHeaderValue(request.headers.get('x-forwarded-host'));
  const host = firstHeaderValue(request.headers.get('host'));

  let fallbackOrigin: string;
  try {
    fallbackOrigin = new URL(request.url).origin;
  } catch {
    fallbackOrigin = 'http://localhost';
  }

  const chosenHost = forwardedHost && isSafeHost(forwardedHost) ? forwardedHost : host && isSafeHost(host) ? host : null;

  if (chosenHost) {
    const proto = forwardedProto === 'https' || forwardedProto === 'http' ? forwardedProto : schemeFrom(request.url);
    return `${proto}://${chosenHost}`;
  }

  // 0.0.0.0 is a bind address, never a destination for a browser.
  if (fallbackOrigin.includes('//0.0.0.0')) return fallbackOrigin.replace('//0.0.0.0', '//localhost');
  return fallbackOrigin;
}

function schemeFrom(url: string): string {
  return url.startsWith('https://') ? 'https' : 'http';
}

/** True when the request reached the server over HTTPS. */
export function isSecureRequest(request: RequestLike): boolean {
  const forwardedProto = firstHeaderValue(request.headers.get('x-forwarded-proto'));
  if (forwardedProto) return forwardedProto === 'https';
  return schemeFrom(request.url) === 'https';
}

/** A same-origin absolute URL for redirects. */
export function absoluteUrl(request: RequestLike, path: string): URL {
  const safePath = path.startsWith('/') && !path.startsWith('//') ? path : '/';
  return new URL(safePath, publicOrigin(request));
}
