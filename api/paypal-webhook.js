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
  return req.headers[name.toLowerCase()];
}

async function readEvent(req) {
  if (req.body) return typeof req.body === "string" ? JSON.parse(req.body) : req.body;

  const chunks = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : null;
}

// --------------------
// PayPal API helpers
// --------------------
async function paypalToken(baseUrl) {
  const basic = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`
  ).toString("base64");

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
  console.log("verify-webhook-signature:", r.status, text.slice(0, 300));

  if (!r.ok) return { ok: false };
  const data = JSON.parse(text);
  return { ok: data.verification_status === "SUCCESS" };
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

// --------------------
// Extractors (FIXED)
// --------------------
function extractOrderIdFromEvent(event) {
  // CHECKOUT.ORDER.COMPLETED
  if (event?.resource?.id && String(event.resource.id).startsWith("5")) {
    return event.resource.id;
  }

  // PAYMENT.CAPTURE.COMPLETED
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
  return {
    value: event?.resource?.amount?.value || null,
    currency: event?.resource?.amount?.currency_code || null,
  };
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
    if (PRODUCT_CATALOG[c]) {
      return { ...PRODUCT_CATALOG[c], matchedBy: c };
    }
  }

  for (const c of candidates) {
    for (const code of PRODUCT_CODES) {
      if (c.includes(code)) {
        return { ...PRODUCT_CATALOG[code], matchedBy: c };
      }
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
      return res.end("Missing body");
    }

    console.log("event_type:", event.event_type);

    const env = (process.env.PAYPAL_ENV || "live").toLowerCase();
    const baseUrl =
      env === "sandbox"
        ? "https://api-m.sandbox.paypal.com"
        : "https://api-m.paypal.com";

    const token = await paypalToken(baseUrl);

    const verify = await verifyWebhook(baseUrl, token, req, event);
    if (!verify.ok) {
      res.statusCode = 400;
      return res.end("Invalid signature");
    }

    const isPaid =
      event.event_type === "PAYMENT.CAPTURE.COMPLETED" ||
      event.event_type === "CHECKOUT.ORDER.COMPLETED";

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
      productImageUrl: absUrl(
        resolved?.productImageUrl || "/patinetes/series-ix/ix3/img/1.jpg"
      ),
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
