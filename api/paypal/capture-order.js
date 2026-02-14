module.exports = async (req, res) => {
  // CORS
  const allowOrigin = (process.env.ALLOWED_ORIGIN || "https://scootshop.co");
  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const orderID = String(body.orderID || "").trim();
    if (!orderID) return res.status(400).json({ error: "Missing orderID" });

    const clientId = process.env.PAYPAL_CLIENT_ID;
    const secret = process.env.PAYPAL_CLIENT_SECRET;
    if (!clientId || !secret) {
      return res.status(500).json({ error: "Missing PAYPAL env vars" });
    }

    const env = (process.env.PAYPAL_ENV || "live").toLowerCase();
    const base = env === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";

    // token
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

    // capture
    const capRes = await fetch(`${base}/v2/checkout/orders/${encodeURIComponent(orderID)}/capture`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${tokenJson.access_token}`,
      },
    });

    const capText = await capRes.text();
    let capJson = {};
    try { capJson = capText ? JSON.parse(capText) : {}; } catch {}

    if (!capRes.ok) {
      console.error("PAYPAL CAPTURE ERROR", capRes.status, capText);
      return res.status(500).json({ error: "PayPal capture error", detail: capJson });
    }

    return res.status(200).json({ status: capJson.status, id: capJson.id, result: capJson });

  } catch (e) {
    console.error("CAPTURE UNHANDLED", e);
    return res.status(500).json({ error: "Internal error", detail: String(e && e.message ? e.message : e) });
  }
};
