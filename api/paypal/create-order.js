module.exports = async (req, res) => {
  // CORS
  const origin = req.headers.origin || "";
  const allowOrigin = (process.env.ALLOWED_ORIGIN || "https://scootshop.co");
  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const name = String(body.name || "").trim() || "Producto SCOOT SHOP";
    const sku = String(body.sku || "").trim();
    const ref = String(body.ref || "").trim();
    const currency = String(body.currency || "EUR").trim().toUpperCase();

    const priceNum = Number(String(body.price || "").replace(",", "."));
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      return res.status(400).json({ error: "Invalid price" });
    }
    const value = priceNum.toFixed(2);

    const clientId = process.env.PAYPAL_CLIENT_ID;
    const secret = process.env.PAYPAL_CLIENT_SECRET;
    if (!clientId || !secret) {
      return res.status(500).json({ error: "Missing PAYPAL env vars" });
    }

    const env = (process.env.PAYPAL_ENV || "live").toLowerCase();
    const base = env === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";

    // 1) Access token
    const tokenRes = await fetch(`${base}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        "Authorization": "Basic " + Buffer.from(`${clientId}:${secret}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });

    const tokenText = await tokenRes.text();
    let tokenJson = {};
    try { tokenJson = tokenText ? JSON.parse(tokenText) : {}; } catch {}
    if (!tokenRes.ok || !tokenJson.access_token) {
      console.error("PAYPAL TOKEN ERROR", tokenRes.status, tokenText);
      return res.status(500).json({ error: "PayPal token error", detail: tokenJson });
    }

    // 2) Create order
    const orderPayload = {
      intent: "CAPTURE",
      purchase_units: [{
        reference_id: ref || undefined,
        description: name,
        custom_id: sku || undefined,
        amount: { currency_code: currency, value },
      }]
    };

    const orderRes = await fetch(`${base}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${tokenJson.access_token}`,
      },
      body: JSON.stringify(orderPayload),
    });

    const orderText = await orderRes.text();
    let orderJson = {};
    try { orderJson = orderText ? JSON.parse(orderText) : {}; } catch {}

    if (!orderRes.ok || !orderJson.id) {
      console.error("PAYPAL CREATE ORDER ERROR", orderRes.status, orderText);
      return res.status(500).json({ error: "PayPal create order error", detail: orderJson });
    }

    return res.status(200).json({ id: orderJson.id });

  } catch (e) {
    console.error("CREATE-ORDER UNHANDLED", e);
    return res.status(500).json({ error: "Internal error", detail: String(e && e.message ? e.message : e) });
  }
};
