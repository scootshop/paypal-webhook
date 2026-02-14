// api/paypal/create-order.js
// Crea una orden PayPal (intent CAPTURE) y devuelve { id }

function parseAllowedOrigins() {
  const raw = process.env.ALLOWED_ORIGINS || "https://scootshop.co";
  return raw
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

function setCors(req, res) {
  const origins = parseAllowedOrigins();
  const origin = req.headers.origin || "";
  const allow = origins.includes(origin) ? origin : origins[0];

  res.setHeader("Access-Control-Allow-Origin", allow);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function readJson(req) {
  if (req.body) {
    if (typeof req.body === "string") return JSON.parse(req.body);
    return req.body;
  }
  const chunks = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function paypalBaseUrl() {
  const env = (process.env.PAYPAL_ENV || "live").toLowerCase();
  return env === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
}

function getPaypalCreds() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_SECRET || process.env.PAYPAL_CLIENT_SECRET;
  return { clientId, secret };
}

async function getAccessToken(baseUrl) {
  const { clientId, secret } = getPaypalCreds();
  if (!clientId || !secret) throw new Error("Missing PAYPAL_CLIENT_ID / PAYPAL_SECRET env vars");

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
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch {}

  if (!r.ok || !data.access_token) {
    console.error("PAYPAL TOKEN ERROR:", r.status, text.slice(0, 1200));
    throw new Error(`PayPal token error: ${r.status}`);
  }
  return data.access_token;
}

module.exports = async (req, res) => {
  try {
    setCors(req, res);

    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    const body = await readJson(req);

    const name = String(body.name || "Producto SCOOT SHOP").trim();
    const sku = String(body.sku || "").trim();          // ej: "IX3", "T10", etc
    const ref = String(body.ref || "").trim();          // ej: "SS-ABC123"
    const currency = String(body.currency || "EUR").trim().toUpperCase();

    const priceNum = Number(String(body.price || "").replace(",", "."));
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      return res.status(400).json({ error: "Invalid price" });
    }
    const value = priceNum.toFixed(2);

    const baseUrl = paypalBaseUrl();
    const accessToken = await getAccessToken(baseUrl);

    // Rellenamos campos que luego tu webhook usa para resolver producto
    const payload = {
      intent: "CAPTURE",
      purchase_units: [
        {
          description: name,
          custom_id: sku || undefined,
          invoice_id: ref || undefined,
          amount: { currency_code: currency, value },
        },
      ],
    };

    const r = await fetch(`${baseUrl}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const text = await r.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch {}

    if (!r.ok || !data.id) {
      console.error("PAYPAL CREATE ORDER ERROR:", r.status, text.slice(0, 2000));
      return res.status(500).json({ error: "PayPal create order error", detail: data });
    }

    return res.status(200).json({ id: data.id });
  } catch (e) {
    console.error("CREATE-ORDER UNHANDLED:", e);
    return res.status(500).json({ error: "Server error", detail: String(e?.message || e) });
  }
};
