// api/paypal/capture-order.js
// Captura una orden PayPal (Orders API). Tras esto, tu webhook recibirá CAPTURE/ORDER COMPLETED y enviará email.

function json(res, code, data) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  if (req.body) return typeof req.body === "string" ? JSON.parse(req.body) : req.body;

  const chunks = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

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
  if (!r.ok) throw new Error(`paypal token error: ${r.status} ${text.slice(0, 200)}`);
  return JSON.parse(text).access_token;
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method Not Allowed" });

    const body = await readBody(req);
    const orderID = String(body.orderID || "").trim();
    if (!orderID) return json(res, 400, { ok: false, error: "Missing orderID" });

    const env = (process.env.PAYPAL_ENV || "live").toLowerCase();
    const baseUrl = env === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";

    const token = await paypalToken(baseUrl);

    const r = await fetch(`${baseUrl}/v2/checkout/orders/${encodeURIComponent(orderID)}/capture`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    const text = await r.text();
    if (!r.ok) {
      return json(res, 502, { ok: false, error: "Capture failed", detail: text.slice(0, 500) });
    }

    const data = JSON.parse(text);
    // Normalmente: data.status === "COMPLETED"
    return json(res, 200, { ok: true, status: data.status || "UNKNOWN", id: data.id || orderID });
  } catch (e) {
    return json(res, 500, { ok: false, error: e?.message || "Server error" });
  }
};

