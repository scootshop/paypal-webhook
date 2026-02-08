// api/paypal-webhook.js
// Webhook PayPal (verifica firma) → obtiene email comprador → obtiene ORDER → resuelve producto → envía email PRO con Resend
// Requiere: /lib/email.js exportando sendEmailResend(...)

const { sendEmailResend } = require("../lib/email");

// =========================
// Catálogo (EDÍTALO con tus 8 productos)
// key = SKU/ID corto (lo ideal: "G2", "IX3", etc.)
// price opcional: si usas fallback por precio
// =========================
const PRODUCT_CATALOG = Object.freeze({
  IX3: {
    name: "iScooter IX3",
    imageUrl: "https://scootshop.co/patinetes/series-ix/ix3/img/1.jpg",
    url: "https://scootshop.co/patinetes/series-ix/ix3/",
    // price: 380.00,
  },

  // EJEMPLOS (rellena con tus rutas reales):
  // G2: {
  //   name: "GT Series G2",
  //   imageUrl: "https://scootshop.co/patinetes/series-gt/g2/img/1.jpg",
  //   url: "https://scootshop.co/patinetes/series-gt/g2/",
  //   price: 799.00,
  // },
  // TF3: { ... },
  // T10: { ... },
});

// Defaults si no se puede identificar producto
const DEFAULTS = Object.freeze({
  productName: process.env.DEFAULT_PRODUCT_NAME || "Pedido Scoot Shop",
  productImageUrl:
    process.env.DEFAULT_PRODUCT_IMAGE_URL ||
    "https://scootshop.co/patinetes/series-ix/ix3/img/1.jpg",
  orderUrl: process.env.DEFAULT_ORDER_URL || "https://scootshop.co/",
});

// =========================
// Helpers
// =========================
function h(req, name) {
  return req.headers[name.toLowerCase()];
}

async function readEvent(req) {
  // Si algún runtime inyecta req.body
  if (req.body) return typeof req.body === "string" ? JSON.parse(req.body) : req.body;

  const chunks = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : null;
}

function normalizeKey(s) {
  return String(s || "").trim().toUpperCase();
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

function detectCatalogKeyFromText(text) {
  const t = normalizeKey(text);
  if (!t) return null;

  // Si contiene exactamente una key del catálogo (ej: "IX3", "G2", etc.)
  for (const key of Object.keys(PRODUCT_CATALOG)) {
    if (t.includes(normalizeKey(key))) return key;
  }
  return null;
}

function findProductByAmount(amountValue) {
  const v = Number(amountValue);
  if (!Number.isFinite(v)) return null;

  // Solo funciona si rellenas "price" por producto
  for (const [key, meta] of Object.entries(PRODUCT_CATALOG)) {
    if (meta && Number.isFinite(Number(meta.price)) && Number(meta.price) === v) return key;
  }
  return null;
}

function resolveProductMeta({ order, event }) {
  const pu = order?.purchase_units?.[0] || null;
  const item0 = pu?.items?.[0] || null;

  // 1) Lo ideal: custom_id / invoice_id (si tú creas el order con Orders API)
  const key1 = detectCatalogKeyFromText(pu?.custom_id);
  if (key1) return { key: key1, ...PRODUCT_CATALOG[key1] };

  const key2 = detectCatalogKeyFromText(pu?.invoice_id);
  if (key2) return { key: key2, ...PRODUCT_CATALOG[key2] };

  // 2) sku / name del item (si PayPal lo trae)
  const key3 = detectCatalogKeyFromText(item0?.sku);
  if (key3) return { key: key3, ...PRODUCT_CATALOG[key3] };

  const key4 = detectCatalogKeyFromText(item0?.name);
  if (key4) return { key: key4, ...PRODUCT_CATALOG[key4] };

  // 3) description o soft_descriptor (a veces ayuda)
  const key5 = detectCatalogKeyFromText(pu?.description || pu?.soft_descriptor);
  if (key5) return { key: key5, ...PRODUCT_CATALOG[key5] };

  // 4) Fallback por precio (si cada producto tiene precio único y rellenaste meta.price)
  const amount =
    pu?.amount?.value ||
    event?.resource?.amount?.value ||
    null;

  const keyByPrice = findProductByAmount(amount);
  if (keyByPrice) return { key: keyByPrice, ...PRODUCT_CATALOG[keyByPrice] };

  // 5) Sin match → defaults
  return {
    key: null,
    name: DEFAULTS.productName,
    imageUrl: DEFAULTS.productImageUrl,
    url: DEFAULTS.orderUrl,
  };
}

// =========================
// PayPal API calls
// =========================
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

// =========================
// Handler
// =========================
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

    // ✅ Solo enviar email cuando el pago está completado
    const isPaid =
      event.event_type === "PAYMENT.CAPTURE.COMPLETED" ||
      event.event_type === "CHECKOUT.ORDER.COMPLETED";

    if (!isPaid) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ ok: true, skipped: true, reason: "not a paid event" }));
    }

    const env = (process.env.PAYPAL_ENV || "live").toLowerCase();
    const baseUrl = env === "sandbox"
      ? "https://api-m.sandbox.paypal.com"
      : "https://api-m.paypal.com";

    const token = await paypalToken(baseUrl);

    const verify = await verifyWebhook(baseUrl, token, req, event);
    if (!verify.ok) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ ok: false, reason: "Invalid signature" }));
    }

    // Buyer email
    let buyerEmail = extractBuyerEmailDirect(event);

    // Order details
    const orderId = extractOrderIdFromEvent(event);
    let order = null;

    if (orderId) {
      order = await getOrderDetails(baseUrl, token, orderId);

      if (!buyerEmail) buyerEmail = order?.payer?.email_address || null;

      // DEBUG si quieres ver el order completo una vez:
      // console.log("ORDER_JSON:", JSON.stringify(order, null, 2));
    }

    if (!buyerEmail) {
      console.log("No buyer email found; no email sent.");
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ ok: true, sent: false, reason: "missing buyer email" }));
    }

    // BCC opcional (copia para ti), NO reemplaza al comprador
    const bcc = (process.env.TEST_EMAIL_TO || "").trim() || undefined;

    // Order ID para el email
    const orderIdForMail = orderId || event?.resource?.id || event?.id || "—";

    // Importe
    const amountFromEvent = extractAmountFromEvent(event);
    const amountValue =
      order?.purchase_units?.[0]?.amount?.value ||
      amountFromEvent.value ||
      undefined;

    const currencyCode =
      order?.purchase_units?.[0]?.amount?.currency_code ||
      amountFromEvent.currency ||
      undefined;

    // Producto (name + image + url)
    const resolved = resolveProductMeta({ order, event });

    // Si PayPal trae item name, úsalo como name (siempre que no esté vacío)
    const itemName = order?.purchase_units?.[0]?.items?.[0]?.name;
    const productNameFinal = (itemName && String(itemName).trim())
      ? itemName
      : resolved.name;

    await sendEmailResend({
      to: buyerEmail,
      bcc,
      orderId: orderIdForMail,

      productName: productNameFinal,
      amountValue,
      currencyCode,

      // ✅ Aquí va lo importante para multi-producto
      productImageUrl: resolved.imageUrl,
      orderUrl: resolved.url,
    });

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({
      ok: true,
      sentTo: buyerEmail,
      bcc: !!bcc,
      productKey: resolved.key,
      productName: productNameFinal,
    }));
  } catch (e) {
    console.log("Server error:", e?.message || e);
    res.statusCode = 500;
    return res.end("Server error");
  }
};
