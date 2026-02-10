// api/paypal/capture-order.js
// Captura una order creada por create-order.js
// Requiere env: PAYPAL_CLIENT_ID, PAYPAL_SECRET, PAYPAL_ENV

function setCors(req, res) {
  const origin = req.headers.origin || "";
  const allowed =
    origin === "https://scootshop.co" ||
    origin.endsWith(".vercel.app") ||
    origin.includes("localhost");

  res.setHeader("Access-Control-Allow-Origin", allowed ? origin : "https://scootshop.co");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Credentials", "false");
}

async function readJson(req) {
  if (req.body) return typeof req.body === "string" ? JSON.parse(req.body) : req.body;

  const chunks = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
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
  if (!r.ok) throw new Error(`paypal token error ${r.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text).access_token;
}

module.exports = async (req, res) => {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ error: "Method Not Allowed" }));
  }

  try {
    const env = (process.env.PAYPAL_ENV || "live").toLowerCase();
    const baseUrl = env === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
    const accessToken = await paypalToken(baseUrl);

    const body = await readJson(req);
    const orderID = String(body?.orderID || body?.orderId || "").trim();

    if (!orderID) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ error: "Missing orderID" }));
    }

    const r = await fetch(`${baseUrl}/v2/checkout/orders/${encodeURIComponent(orderID)}/capture`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    const text = await r.text();
    if (!r.ok) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ error: "PayPal capture failed", detail: text.slice(0, 500) }));
    }

    const data = JSON.parse(text);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");

    // PayPal devuelve status en el body
    return res.end(JSON.stringify({
      status: data.status,
      id: data.id,
    }));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ error: "Server error", detail: String(e?.message || e) }));
  }
};
