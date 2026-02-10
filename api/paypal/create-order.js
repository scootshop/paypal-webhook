// /api/paypal/create-order.js
// Crea una orden PayPal usando PRECIO DEL SERVIDOR (no del cliente)

function setCors(req, res) {
  const origin = req.headers.origin || "";
  const allowed = new Set([
    "https://scootshop.co",
    "https://www.scootshop.co",
  ]);

  if (allowed.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    // si quieres, deja fijo tu dominio en vez de reflejar
    res.setHeader("Access-Control-Allow-Origin", "https://scootshop.co");
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function readJson(req) {
  if (req.body) return typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const chunks = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function paypalBase() {
  const env = (process.env.PAYPAL_ENV || "live").toLowerCase();
  return env === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
}

async function paypalToken() {
  const baseUrl = paypalBase();
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
  if (!r.ok) throw new Error(`paypal token error ${r.status}: ${text.slice(0, 200)}`);
  return { access_token: JSON.parse(text).access_token, baseUrl };
}

// ✅ Catálogo SERVER-SIDE (la fuente de verdad)
const PRODUCT_CATALOG = Object.freeze({
  T10: { name: "T10", price: "450.00", currency: "EUR" },
  TF3: { name: "TF3", price: "799.00", currency: "EUR" },
  IX3: { name: "IX3", price: "399.00", currency: "EUR" },
  G2:  { name: "G2",  price: "299.00", currency: "EUR" },
  N7PRO:{ name: "N7PRO", price: "349.00", currency: "EUR" },
  S4:  { name: "S4",  price: "279.00", currency: "EUR" },
  T30: { name: "T30", price: "899.00", currency: "EUR" },
  W9:  { name: "W9",  price: "499.00", currency: "EUR" },
});

function normSku(v) {
  return String(v || "").trim().toUpperCase();
}

module.exports = async (req, res) => {
  try {
    setCors(req, res);

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      return res.end();
    }

    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ ok: false, error: "Method Not Allowed" }));
    }

    const body = await readJson(req);
    const sku = normSku(body.sku);

    if (!sku || !PRODUCT_CATALOG[sku]) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ ok: false, error: "SKU inválido" }));
    }

    const item = PRODUCT_CATALOG[sku];
    const ref = String(body.ref || "").slice(0, 64) || `SS-${Date.now()}`;

    const { access_token, baseUrl } = await paypalToken();

    // Crear orden PayPal
    const payload = {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: sku,                 // útil para tu resolveProductFromOrder
          custom_id: ref,                    // tu referencia interna
          description: `SCOOT SHOP · ${item.name}`,
          amount: {
            currency_code: item.currency,
            value: item.price,
          },
          items: [
            {
              name: item.name,
              sku: sku,
              quantity: "1",
              unit_amount: {
                currency_code: item.currency,
                value: item.price,
              },
            },
          ],
        },
      ],
      application_context: {
        brand_name: "SCOOT SHOP",
        user_action: "PAY_NOW",
        shipping_preference: "NO_SHIPPING",
      },
    };

    const r = await fetch(`${baseUrl}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const text = await r.text();
    if (!r.ok) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ ok: false, error: "create order failed", detail: text.slice(0, 500) }));
    }

    const data = JSON.parse(text);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ ok: true, id: data.id }));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ ok: false, error: "Server error", detail: String(e?.message || e) }));
  }
};
