// api/paypal/capture-order.js
// Captura una orden PayPal y devuelve { status, id, result }

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
    const orderID = String(body.orderID || body.orderId || "").trim();
    if (!orderID) return res.status(400).json({ error: "Missing orderID" });

    const baseUrl = paypalBaseUrl();
    const accessToken = await getAccessToken(baseUrl);

    const r = await fetch(`${baseUrl}/v2/checkout/orders/${encodeURIComponent(orderID)}/capture`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    const text = await r.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch {}

    if (!r.ok) {
      console.error("PAYPAL CAPTURE ERROR:", r.status, text.slice(0, 2000));
      return res.status(500).json({ error: "PayPal capture error", detail: data });
    }

    return res.status(200).json({ status: data.status, id: data.id, result: data });
  } catch (e) {
    console.error("CAPTURE-ORDER UNHANDLED:", e);
    return res.status(500).json({ error: "Server error", detail: String(e?.message || e) });
  }
};
