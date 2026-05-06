// WW Pixel Relay — runs inside Shopify's Customer Events sandbox.
// Reads per-shop settings injected by webPixelCreate, then loads each platform's
// tracking script and forwards Customer Events to it.
//
// This is the "fix" that survives the Aug 26 2026 retirement of legacy checkout:
// the code runs in the upgraded checkout / thank-you / order status sandbox.
//
// Supported platforms in V1.5: Meta Pixel, Google Ads, TikTok Pixel, Klaviyo Onsite,
// Pinterest Tag. Each one is initialized only if its setting is present.

import { register } from "@shopify/web-pixels-extension";

register(({ analytics, browser, settings }) => {
  // -----------------------------
  // Meta Pixel
  // -----------------------------
  if (settings.metaPixelId) {
    initMetaPixel(settings.metaPixelId);
  }

  // -----------------------------
  // Google Ads
  // -----------------------------
  if (settings.googleAdsId) {
    initGoogleAds(settings.googleAdsId);
  }

  // -----------------------------
  // TikTok Pixel
  // -----------------------------
  if (settings.tiktokPixelId) {
    initTikTokPixel(settings.tiktokPixelId);
  }

  // -----------------------------
  // Klaviyo Onsite
  // -----------------------------
  if (settings.klaviyoCompanyId) {
    initKlaviyo(settings.klaviyoCompanyId);
  }

  // -----------------------------
  // Pinterest Tag
  // -----------------------------
  if (settings.pinterestTagId) {
    initPinterestTag(settings.pinterestTagId);
  }

  // -----------------------------
  // Subscribe to Customer Events
  // -----------------------------
  analytics.subscribe("page_viewed", () => {
    if (settings.metaPixelId)     window.fbq && window.fbq("track", "PageView");
    if (settings.tiktokPixelId)   window.ttq && window.ttq.track && window.ttq.track("Pageview");
    if (settings.pinterestTagId)  window.pintrk && window.pintrk("track", "pagevisit");
  });

  analytics.subscribe("product_viewed", (event) => {
    const variant = event.data?.productVariant;
    const price = variant?.price?.amount;
    const currency = variant?.price?.currencyCode || "USD";
    const productId = variant?.product?.id;

    if (settings.metaPixelId && window.fbq) {
      window.fbq("track", "ViewContent", {
        content_ids: productId ? [String(productId)] : [],
        content_type: "product",
        value: numberOrZero(price),
        currency,
      });
    }
    if (settings.tiktokPixelId && window.ttq && window.ttq.track) {
      window.ttq.track("ViewContent", {
        content_id: productId ? String(productId) : undefined,
        value: numberOrZero(price),
        currency,
      });
    }
    if (settings.pinterestTagId && window.pintrk) {
      window.pintrk("track", "pagevisit", {
        product_id: productId ? String(productId) : undefined,
      });
    }
    if (settings.klaviyoCompanyId && window._learnq) {
      window._learnq.push(["track", "Viewed Product", {
        ProductID: productId ? String(productId) : undefined,
        Price: numberOrZero(price),
      }]);
    }
  });

  analytics.subscribe("product_added_to_cart", (event) => {
    const ci = event.data?.cartLine;
    const variant = ci?.merchandise;
    const price = variant?.price?.amount;
    const currency = variant?.price?.currencyCode || "USD";
    const qty = ci?.quantity || 1;
    const value = numberOrZero(price) * qty;

    if (settings.metaPixelId && window.fbq) {
      window.fbq("track", "AddToCart", {
        content_ids: variant?.product?.id ? [String(variant.product.id)] : [],
        content_type: "product",
        value, currency,
      });
    }
    if (settings.tiktokPixelId && window.ttq && window.ttq.track) {
      window.ttq.track("AddToCart", { value, currency });
    }
    if (settings.pinterestTagId && window.pintrk) {
      window.pintrk("track", "addtocart", { value, currency });
    }
    if (settings.klaviyoCompanyId && window._learnq) {
      window._learnq.push(["track", "Added to Cart", { Value: value }]);
    }
  });

  analytics.subscribe("checkout_completed", (event) => {
    const checkout = event.data?.checkout;
    const total = checkout?.totalPrice?.amount;
    const currency = checkout?.totalPrice?.currencyCode || "USD";
    const orderId = checkout?.order?.id;
    const value = numberOrZero(total);

    if (settings.metaPixelId && window.fbq) {
      window.fbq("track", "Purchase", { value, currency });
    }
    if (settings.googleAdsId && window.gtag) {
      const sendTo = settings.googleAdsLabel
        ? `${settings.googleAdsId}/${settings.googleAdsLabel}`
        : settings.googleAdsId;
      window.gtag("event", "conversion", {
        send_to: sendTo,
        value,
        currency,
        transaction_id: orderId ? String(orderId) : undefined,
      });
    }
    if (settings.tiktokPixelId && window.ttq && window.ttq.track) {
      window.ttq.track("CompletePayment", { value, currency });
    }
    if (settings.pinterestTagId && window.pintrk) {
      window.pintrk("track", "checkout", { value, currency, order_id: orderId });
    }
    if (settings.klaviyoCompanyId && window._learnq) {
      window._learnq.push(["track", "Placed Order", { OrderId: orderId, Value: value }]);
    }
  });
});

// -----------------------------
// Loaders for each platform
// -----------------------------
function initMetaPixel(id) {
  // The standard Meta Pixel boot code, adapted to run in the sandbox.
  if (window.fbq) return;
  const f = window;
  const b = document;
  const e = "script";
  const fbq = function () {
    fbq.callMethod ? fbq.callMethod.apply(fbq, arguments) : fbq.queue.push(arguments);
  };
  if (!f._fbq) f._fbq = fbq;
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = "2.0";
  fbq.queue = [];
  window.fbq = fbq;
  const t = b.createElement(e);
  t.async = true;
  t.src = "https://connect.facebook.net/en_US/fbevents.js";
  const s = b.getElementsByTagName(e)[0];
  s.parentNode.insertBefore(t, s);
  fbq("init", id);
}

function initGoogleAds(id) {
  if (window.gtag) return;
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag("js", new Date());
  window.gtag("config", id);
}

function initTikTokPixel(id) {
  if (window.ttq) return;
  (function (w, d, t) {
    w.TiktokAnalyticsObject = t;
    const ttq = w[t] = w[t] || [];
    ttq.methods = ["page", "track", "identify", "instances", "debug", "on", "off", "once", "ready", "alias", "group", "enableCookie", "disableCookie"];
    ttq.setAndDefer = function (e, t) { e[t] = function () { e.push([t].concat(Array.prototype.slice.call(arguments, 0))); }; };
    for (let i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(ttq, ttq.methods[i]);
    ttq.instance = function (e) {
      const t = ttq._i[e] || [];
      for (let n = 0; n < ttq.methods.length; n++) ttq.setAndDefer(t, ttq.methods[n]);
      return t;
    };
    ttq.load = function (e, n) {
      const i = "https://analytics.tiktok.com/i18n/pixel/events.js";
      ttq._i = ttq._i || {};
      ttq._i[e] = [];
      ttq._i[e]._u = i;
      ttq._t = ttq._t || {};
      ttq._t[e] = +new Date;
      ttq._o = ttq._o || {};
      ttq._o[e] = n || {};
      const o = document.createElement("script");
      o.type = "text/javascript";
      o.async = true;
      o.src = i + "?sdkid=" + e + "&lib=" + t;
      const a = document.getElementsByTagName("script")[0];
      a.parentNode.insertBefore(o, a);
    };
    ttq.load(id);
    ttq.page();
  })(window, document, "ttq");
}

function initKlaviyo(companyId) {
  if (window._learnq) return;
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://static.klaviyo.com/onsite/js/klaviyo.js?company_id=${encodeURIComponent(companyId)}`;
  document.head.appendChild(s);
  window._learnq = window._learnq || [];
}

function initPinterestTag(tagId) {
  if (window.pintrk) return;
  (function (e) {
    if (!window.pintrk) {
      window.pintrk = function () { window.pintrk.queue.push(Array.prototype.slice.call(arguments)); };
      const n = window.pintrk;
      n.queue = []; n.version = "3.0";
      const t = document.createElement("script");
      t.async = true; t.src = e;
      const r = document.getElementsByTagName("script")[0];
      r.parentNode.insertBefore(t, r);
    }
  })("https://s.pinimg.com/ct/core.js");
  window.pintrk("load", tagId);
  window.pintrk("page");
}

function numberOrZero(v) {
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}
