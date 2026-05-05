// Utility for server-side redirects inside an embedded Shopify admin app.
//
// Remix's <Form> defaults to posting to the pathname without search params,
// so `request.url` inside an action doesn't carry shop/host/id_token/embedded.
// Those params are required by @shopify/shopify-app-remix's validateShopAndHostParams,
// and if they're missing from the redirect target the next GET will bounce to
// the login screen.
//
// We recover them from the Referer header (which is the full URL of the page
// that submitted the form) and then merge in any overrides.

export function redirectUrl(
  request: Request,
  pathname: string,
  overrides: Record<string, string | undefined> = {},
): string {
  const referer = request.headers.get("referer");
  const fallback = new URL(request.url);
  let params = new URLSearchParams();

  if (referer) {
    try {
      params = new URL(referer).searchParams;
    } catch {
      params = fallback.searchParams;
    }
  } else {
    params = fallback.searchParams;
  }

  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) {
      params.delete(k);
    } else {
      params.set(k, v);
    }
  }

  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
