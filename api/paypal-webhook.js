// api/paypal-webhook.js
// Webhook PayPal (verifica firma) → obtiene email comprador → resuelve producto → envía email PRO con Resend
// Requiere: /lib/email.js exportando sendEmailResend(...)

const { sendEmailResend } = require("../lib/email");

function h(req, name) {
  return req.headers[name.toLowerCase()];
}

async function readEvent(req) {
  if (req.body) return typeof req.body === "string" ? JSON.parse(req.body) : req.body;

  const chunks = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : null;
}

async function paypalToken(baseUrl) {
  const basic = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`).toString("base64");

  const r = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const text = await r.text();
  console.log("paypalToken:", r.status, text.slice(0, 200));
  if (!r.ok) throw new Error(`paypal token error: ${r.status}`);
  return JSON.parse(text).access_token;
}

async function verifyWebhook(baseUrl, accessToken, req, event) {
  const payload = {
    auth_algo: h(req, "paypal-auth-algo"),
    cert_url: h(req, "paypal-cert-url"),
    transmission_id: h(req, "paypal-transmission-id"),
    transmission_sig: h(req, "paypal-transmission-sig"),
    transmission_time: h(req, "paypal-transmission-time"),
    webhook_id: process.env.PAYPAL_WEBHOOK_ID,
    webhook_event: event,
  };

  const r = await fetch(`${baseUrl}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await r.text();
  console.log("verify-webhook-signature:", r.status, text.slice(0, 500));

  if (!r.ok) return { ok: false, status: r.status, body: text };

  const data = JSON.parse(text);
  return { ok: data.verification_status === "SUCCESS", data };
}

async function getOrderDetails(baseUrl, accessToken, orderId) {
  const r = await fetch(`${baseUrl}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const text = await r.text();
  console.log("getOrderDetails:", r.status, text.slice(0, 200));
  if (!r.ok) throw new Error(`get order error: ${r.status}`);
  return JSON.parse(text);
}

function extractOrderIdFromEvent(event) {
  return (
    event?.resource?.supplementary_data?.related_ids?.order_id ||
    event?.resource?.supplementary_data?.related_ids?.checkout_order_id ||
    null
  );
}

function extractBuyerEmailDirect(event) {
  return event?.resource?.payer?.email_address || null;
}

function extractAmountFromEvent(event) {
  const v = event?.resource?.amount?.value || null;
  const c = event?.resource?.amount?.currency_code || null;
  return { value: v, currency: c };
}

function normKey(s) {
  return String(s || "").trim().toUpperCase();
}

function absUrl(pathOrUrl) {
  const u = String(pathOrUrl || "").trim();
  if (!u) return "";
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  if (u.startsWith("/")) return "https://scootshop.co" + u;
  return "https://scootshop.co/" + u;
}

// ======================================================
// ✅ Catálogo (producto → URL + imagen + nombre)
// Incluye claves por "código producto" y por "data-paypal" (hosted id)
// ======================================================
const PRODUCT_CATALOG = Object.freeze({
  // Series N
  N7PRO: {
    productName: "N7PRO",
    orderUrl: "https://scootshop.co/patinetes/series-n/n7/",
    productImageUrl: "https://scootshop.co/patinetes/series-n/n7/img/1.jpg",
  },
  PSFEEEULL7H5Y: {
    productName: "N7PRO",
    orderUrl: "https://scootshop.co/patinetes/series-n/n7/",
    productImageUrl: "https://scootshop.co/patinetes/series-n/n7/img/1.jpg",
  },

  S4: {
    productName: "ZWheel MASCOOTER S4",
    orderUrl: "https://scootshop.co/patinetes/series-n/s4/",
    productImageUrl: "https://scootshop.co/patinetes/series-n/s4/img/1.jpg",
  },
  "3HAMJE5SBQPTG": {
    productName: "ZWheel MASCOOTER S4",
    orderUrl: "https://scootshop.co/patinetes/series-n/s4/",
    productImageUrl: "https://scootshop.co/patinetes/series-n/s4/img/1.jpg",
  },

  // Series GT
  G2: {
    productName: "G2",
    orderUrl: "https://scootshop.co/patinetes/series-gt/g2/",
    productImageUrl: "https://scootshop.co/patinetes/series-gt/g2/img/1.jpg",
  },
  "7AFW42AS3FC8Q": {
    productName: "G2",
    orderUrl: "https://scootshop.co/patinetes/series-gt/g2/",
    productImageUrl: "https://scootshop.co/patinetes/series-gt/g2/img/1.jpg",
  },

  T10: {
    productName: "T10",
    orderUrl: "https://scootshop.co/patinetes/series-gt/t10/",
    productImageUrl: "https://scootshop.co/patinetes/series-gt/t10/img/1.jpg",
  },
  WE5GUHM4PSVYQ: {
    productName: "T10",
    orderUrl: "https://scootshop.co/patinetes/series-gt/t10/",
    productImageUrl: "https://scootshop.co/patinetes/series-gt/t10/img/1.jpg",
  },

  TF3: {
    productName: "TF3",
    orderUrl: "https://scootshop.co/patinetes/series-gt/tf3/",
    productImageUrl: "https://scootshop.co/patinetes/series-gt/tf3/img/1.jpg",
  },
  JAEYYZG6XE7HQ: {
    productName: "TF3",
    orderUrl: "https://scootshop.co/patinetes/series-gt/tf3/",
    productImageUrl: "https://scootshop.co/patinetes/series-gt/tf3/img/1.jpg",
  },

  T30: {
    productName: "T30",
    orderUrl: "https://scootshop.co/patinetes/series-gt/t30/",
    productImageUrl: "https://scootshop.co/patinetes/series-gt/t30/img/1.jpg",
  },
  J3VG9GQ3QU6A6: {
    productName: "T30",
    orderUrl: "https://scootshop.co/patinetes/series-gt/t30/",
    productImageUrl: "https://scootshop.co/patinetes/series-gt/t30/img/1.jpg",
  },

  // Serie IX
  IX3: {
    productName: "IX3",
    orderUrl: "https://scootshop.co/patinetes/series-ix/ix3/",
    productImageUrl: "https://scootshop.co/patinetes/series-ix/ix3/img/1.jpg",
  },
  "7ML59E5E7UA66": {
    productName: "IX3",
    orderUrl: "https://scootshop.co/patinetes/series-ix/ix3/",
    productImageUrl: "https://scootshop.co/patinetes/series-ix/ix3/img/1.jpg",
  },

  W9: {
    productName: "W9",
    orderUrl: "https://scootshop.co/patinetes/series-ix/w9/",
    productImageUrl: "https://scootshop.co/patinetes/series-ix/w9/img/1.jpg",
  },
  "3JT9QGYWBE496": {
    productName: "W9",
    orderUrl: "https://scootshop.co/patinetes/series-ix/w9/",
    productImageUrl: "https://scootshop.co/patinetes/series-ix/w9/img/1.jpg",
  },
});

const PRODUCT_CODES = ["N7PRO", "S4", "G2", "T10", "TF3", "T30", "IX3", "W9"];

function resolveProductFromOrder(order) {
  const pu = order?.purchase_units?.[0] || null;
  const item0 = pu?.items?.[0] || null;

  const candidates = [
    pu?.custom_id,
    pu?.invoice_id,
    pu?.reference_id,
    item0?.sku,
    item0?.name,
    pu?.description,
    order?.purchase_units?.[0]?.soft_descriptor,
  ]
    .filter(Boolean)
    .map(normKey);

  // 1) match exact (incluye IDs data-paypal)
  for (const c of candidates) {
    if (PRODUCT_CATALOG[c]) return { ...PRODUCT_CATALOG[c], matchedBy: c };
  }

  // 2) match por contener código producto (TF3, T10, etc.)
  for (const c of candidates) {
    for (const code of PRODUCT_CODES) {
      if (c.includes(code) && PRODUCT_CATALOG[code]) {
        return { ...PRODUCT_CATALOG[code], matchedBy: c };
      }
    }
  }

  return null;
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.statusCode = 405;
      return res.end("Method Not Allowed");
    }

    const event = await readEvent(req);
    if (!event) {
      res.statusCode = 400;
      return res.end("Missing body");
    }

    console.log("event_type:", event.event_type);

    const env = (process.env.PAYPAL_ENV || "live").toLowerCase();
    const baseUrl = env === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";

    const token = await paypalToken(baseUrl);

    const verify = await verifyWebhook(baseUrl, token, req, event);
    if (!verify.ok) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ ok: false, reason: "Invalid signature" }));
    }

    // Solo enviar cuando el pago está completado
    const isPaid =
      event.event_type === "PAYMENT.CAPTURE.COMPLETED" ||
      event.event_type === "CHECKOUT.ORDER.COMPLETED";

    if (!isPaid) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ ok: true, skipped: true, reason: "not a paid event" }));
    }

    let buyerEmail = extractBuyerEmailDirect(event);

    const orderId = extractOrderIdFromEvent(event);
    let order = null;

    if ((!buyerEmail || !order) && orderId) {
      order = await getOrderDetails(baseUrl, token, orderId);
      buyerEmail = buyerEmail || order?.payer?.email_address || null;
    }

    if (!buyerEmail) {
      console.log("No buyer email found; no email sent.");
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ ok: true, sent: false, reason: "missing buyer email" }));
    }

    const bcc = (process.env.TEST_EMAIL_TO || "").trim();

    const orderIdForMail = orderId || event?.resource?.id || event?.id || "—";

    // defaults (fallback)
    const defaults = {
      productName: process.env.DEFAULT_PRODUCT_NAME || "Pedido Scoot Shop",
      productImageUrl: absUrl(process.env.DEFAULT_PRODUCT_IMAGE_URL || "/patinetes/series-ix/ix3/img/1.jpg"),
      orderUrl: absUrl(process.env.DEFAULT_ORDER_URL || "/"),
    };

    const amountFromEvent = extractAmountFromEvent(event);

    // Resolver producto desde el Order (si es posible)
    const resolved = order ? resolveProductFromOrder(order) : null;
    if (resolved) console.log("resolved product:", resolved.productName, "matchedBy:", resolved.matchedBy);
    else console.log("resolved product: NONE (using defaults)");

    const amountValue =
      order?.purchase_units?.[0]?.amount?.value ||
      amountFromEvent.value ||
      undefined;

    const currencyCode =
      order?.purchase_units?.[0]?.amount?.currency_code ||
      amountFromEvent.currency ||
      undefined;

    await sendEmailResend({
      to: buyerEmail,
      bcc: bcc || undefined,
      orderId: orderIdForMail,

      productName: resolved?.productName || defaults.productName,
      amountValue,
      currencyCode,
      productImageUrl: resolved?.productImageUrl || defaults.productImageUrl,
      orderUrl: resolved?.orderUrl || defaults.orderUrl,
    });

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ ok: true, sentTo: buyerEmail, bcc: !!bcc }));
  } catch (e) {
    console.log("Server error:", e?.message || e);
    res.statusCode = 500;
    return res.end("Server error");
  }
};
