// api/paypal-webhook.js
// Webhook PayPal (verifica firma) → obtiene email comprador → resuelve producto → envía email PRO con Resend
// Compatible con:
// - PAYMENT.CAPTURE.COMPLETED
// - CHECKOUT.ORDER.COMPLETED
// Requiere: /lib/email.js exportando sendEmailResend(...)

const { sendEmailResend } = require("../lib/email");

// --------------------
// Helpers
// --------------------
function h(req, name) {
  // Node/Vercel normaliza headers a minúsculas, pero por seguridad intentamos ambos
  const k = String(name || "").toLowerCase();
  return req.headers?.[k] || req.headers?.[name] || null;
}

async function readEvent(req) {
  try {
    if (req.body) {
      return typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    }

    const chunks = [];
    for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    const raw = Buffer.concat(chunks).toString("utf8");
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.error("readEvent parse error:", e);
    return null;
  }
}

function jsonOrNull(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

// --------------------
// PayPal API helpers
// --------------------
function paypalBaseUrl() {
  const env = (process.env.PAYPAL_ENV || "live").toLowerCase();
  return env === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
}

function getPaypalCreds() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  // Compat: algunos proyectos usan PAYPAL_SECRET, otros PAYPAL_CLIENT_SECRET
  const secret = process.env.PAYPAL_SECRET || process.env.PAYPAL_CLIENT_SECRET;

  return { clientId, secret };
}

async function paypalToken(baseUrl) {
  const { clientId, secret } = getPaypalCreds();
  if (!clientId || !secret) {
    throw new Error("Missing PAYPAL_CLIENT_ID / PAYPAL_SECRET (or PAYPAL_CLIENT_SECRET) env vars");
  }

  const basic = Buffer.from(`${clientId}:${secret}`).toString("base64");

  const r = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const text = await r.text();
  const data = jsonOrNull(text);

  console.log("paypalToken:", r.status, text.slice(0, 200));

  if (!r.ok || !data?.access_token) {
    console.error("paypalToken error body:", text.slice(0, 2000));
    throw new Error(`paypal token error: ${r.status}`);
  }

  return data.access_token;
}

async function verifyWebhook(baseUrl, accessToken, req, event) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) {
    console.error("Missing PAYPAL_WEBHOOK_ID env var");
    return { ok: false, reason: "missing_webhook_id" };
  }

  const payload = {
    auth_algo: h(req, "paypal-auth-algo"),
    cert_url: h(req, "paypal-cert-url"),
    transmission_id: h(req, "paypal-transmission-id"),
    transmission_sig: h(req, "paypal-transmission-sig"),
    transmission_time: h(req, "paypal-transmission-time"),
    webhook_id: webhookId,
    webhook_event: event,
  };

  // Si faltan headers críticos, no tiene sentido llamar a PayPal
  const required = ["auth_algo", "cert_url", "transmission_id", "transmission_sig", "transmission_time"];
  for (const k of required) {
    if (!payload[k]) {
      console.error("Missing PayPal header for verification:", k);
      return { ok: false, reason: "missing_headers" };
    }
  }

  const r = await fetch(`${baseUrl}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await r.text();
  console.log("verify-webhook-signature:", r.status, text.slice(0, 300));

  if (!r.ok) {
    console.error("verify-webhook-signature error body:", text.slice(0, 2000));
    return { ok: false, reason: `paypal_${r.status}` };
  }

  const data = jsonOrNull(text);
  return { ok: data?.verification_status === "SUCCESS" };
}

async function getOrderDetails(baseUrl, accessToken, orderId) {
  const r = await fetch(`${baseUrl}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const text = await r.text();
  console.log("getOrderDetails:", r.status, text.slice(0, 200));

  if (!r.ok) {
    console.error("getOrderDetails error body:", text.slice(0, 2000));
    throw new Error(`get order error: ${r.status}`);
  }

  const data = jsonOrNull(text);
  if (!data) throw new Error("get order error: invalid json");
  return data;
}

// --------------------
// Extractors
// --------------------
function extractOrderIdFromEvent(event) {
  const type = String(event?.event_type || "");

  // En CHECKOUT.ORDER.* el resource.id es el ID de la orden
  if (type.startsWith("CHECKOUT.ORDER.") && event?.resource?.id) {
    return String(event.resource.id);
  }

  // En PAYMENT.CAPTURE.* el resource.id suele ser el CAPTURE id, no el order id
  return (
    event?.resource?.supplementary_data?.related_ids?.order_id ||
    event?.resource?.supplementary_data?.related_ids?.checkout_order_id ||
    null
  );
}

function extractBuyerEmailDirect(event) {
  return event?.resource?.payer?.email_address || null;
}

function normKey(s) {
  return String(s || "").trim().toUpperCase();
}

function absUrl(pathOrUrl) {
  if (!pathOrUrl) return "";
  if (pathOrUrl.startsWith("http")) return pathOrUrl;
  return "https://scootshop.co" + (pathOrUrl.startsWith("/") ? pathOrUrl : "/" + pathOrUrl);
}

// --------------------
// Product catalog
// --------------------
const PRODUCT_CATALOG = Object.freeze({
  N7PRO: {
    productName: "N7PRO",
    orderUrl: "/patinetes/series-n/n7/",
    productImageUrl: "/patinetes/series-n/n7/img/1.jpg",
  },
  S4: {
    productName: "ZWheel MASCOOTER S4",
    orderUrl: "/patinetes/series-n/s4/",
    productImageUrl: "/patinetes/series-n/s4/img/1.jpg",
  },
  G2: {
    productName: "G2",
    orderUrl: "/patinetes/series-gt/g2/",
    productImageUrl: "/patinetes/series-gt/g2/img/1.jpg",
  },
  T10: {
    productName: "T10",
    orderUrl: "/patinetes/series-gt/t10/",
    productImageUrl: "/patinetes/series-gt/t10/img/1.jpg",
  },
  TF3: {
    productName: "TF3",
    orderUrl: "/patinetes/series-gt/tf3/",
    productImageUrl: "/patinetes/series-gt/tf3/img/1.jpg",
  },
  T30: {
    productName: "T30",
    orderUrl: "/patinetes/series-gt/t30/",
    productImageUrl: "/patinetes/series-gt/t30/img/1.jpg",
  },
  IX3: {
    productName: "IX3",
    orderUrl: "/patinetes/series-ix/ix3/",
    productImageUrl: "/patinetes/series-ix/ix3/img/1.jpg",
  },
  W9: {
    productName: "W9",
    orderUrl: "/patinetes/series-ix/w9/",
    productImageUrl: "/patinetes/series-ix/w9/img/1.jpg",
  },
});

const PRODUCT_CODES = Object.keys(PRODUCT_CATALOG);

// --------------------
// Product resolver
// --------------------
function resolveProductFromOrder(order) {
  const pu = order?.purchase_units?.[0];
  if (!pu) return null;

  const item0 = pu.items?.[0];

  const candidates = [
    pu.custom_id,
    pu.reference_id,
    pu.invoice_id,
    item0?.sku,
    item0?.name,
    pu.description,
  ]
    .filter(Boolean)
    .map(normKey);

  for (const c of candidates) {
    if (PRODUCT_CATALOG[c]) return { ...PRODUCT_CATALOG[c], matchedBy: c };
  }

  for (const c of candidates) {
    for (const code of PRODUCT_CODES) {
      if (c.includes(code)) return { ...PRODUCT_CATALOG[code], matchedBy: c };
    }
  }

  return null;
}

// --------------------
// Main handler
// --------------------
module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.statusCode = 405;
      return res.end("Method Not Allowed");
    }

    const event = await readEvent(req);
    if (!event) {
      res.statusCode = 400;
      return res.end("Invalid/Missing JSON body");
    }

    const eventType = String(event.event_type || "");
    console.log("event_type:", eventType);

    const baseUrl = paypalBaseUrl();
    const token = await paypalToken(baseUrl);

    const verify = await verifyWebhook(baseUrl, token, req, event);
    if (!verify.ok) {
      res.statusCode = 400;
      return res.end("Invalid signature");
    }

    const isPaid =
      eventType === "PAYMENT.CAPTURE.COMPLETED" ||
      eventType === "CHECKOUT.ORDER.COMPLETED";

    if (!isPaid) {
      res.statusCode = 200;
      return res.end("Ignored");
    }

    const orderId = extractOrderIdFromEvent(event);
    if (!orderId) {
      console.log("No orderId found");
      res.statusCode = 200;
      return res.end("No orderId");
    }

    const order = await getOrderDetails(baseUrl, token, orderId);

    const buyerEmail =
      extractBuyerEmailDirect(event) ||
      order?.payer?.email_address ||
      null;

    if (!buyerEmail) {
      console.log("No buyer email");
      res.statusCode = 200;
      return res.end("No buyer email");
    }

    const resolved = resolveProductFromOrder(order);
    console.log("resolved product:", resolved?.productName || "NONE");

    const amountValue = order?.purchase_units?.[0]?.amount?.value;
    const currencyCode = order?.purchase_units?.[0]?.amount?.currency_code;

    await sendEmailResend({
      to: buyerEmail,
      orderId,
      productName: resolved?.productName || "Pedido Scoot Shop",
      amountValue,
      currencyCode,
      productImageUrl: absUrl(resolved?.productImageUrl || "/patinetes/series-ix/ix3/img/1.jpg"),
      orderUrl: absUrl(resolved?.orderUrl || "/"),
      bcc: process.env.TEST_EMAIL_TO || undefined,
    });

    res.statusCode = 200;
    return res.end("OK");
  } catch (e) {
    console.error("Webhook error:", e);
    res.statusCode = 500;
    return res.end("Server error");
  }
};
