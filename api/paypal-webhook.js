function h(req, name) {
  return req.headers[name.toLowerCase()];
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : null;
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

  if (!r.ok) throw new Error("paypal token error");
  const data = await r.json();
  return data.access_token;
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

  if (!r.ok) return false;
  const data = await r.json();
  return data.verification_status === "SUCCESS";
}

function getOrderUrl(baseUrl, event) {
  const links = event?.resource?.links || [];
  const up = links.find((l) => l?.rel === "up" && l?.href);
  if (up?.href) return up.href;

  const orderId = event?.resource?.supplementary_data?.related_ids?.order_id;
  if (orderId) return `${baseUrl}/v2/checkout/orders/${orderId}`;

  return null;
}

async function fetchOrder(orderUrl, accessToken) {
  const r = await fetch(orderUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) throw new Error("paypal order fetch error");
  return r.json();
}

async function sendEmailResend({ to, orderId }) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.MAIL_FROM, // "Scoot Shop <support@scootshop.co>"
      to,
      subject: `Pedido confirmado — en preparación (#${orderId})`,
      text:
`Hola,
Hemos recibido tu pago correctamente. Tu pedido está confirmado y ya está en preparación.

Nº pedido: ${orderId}

Te avisaremos cuando salga enviado con su seguimiento.
Support — Scoot Shop`,
      reply_to: "support@scootshop.co",
    }),
  });

  if (!r.ok) throw new Error("resend send error");
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.statusCode = 405;
      return res.end("Method Not Allowed");
    }

    const event = await readJson(req);
    if (!event) {
      res.statusCode = 400;
      return res.end("Missing body");
    }

    const env = (process.env.PAYPAL_ENV || "sandbox").toLowerCase();
    const baseUrl =
      env === "sandbox"
        ? "https://api-m.sandbox.paypal.com"
        : "https://api-m.paypal.com";

    const token = await paypalToken(baseUrl);
    const ok = await verifyWebhook(baseUrl, token, req, event);
    if (!ok) {
      res.statusCode = 400;
      return res.end("Invalid signature");
    }

    if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
      const orderUrl = getOrderUrl(baseUrl, event);
      if (orderUrl) {
        const order = await fetchOrder(orderUrl, token);
        const buyerEmail = order?.payer?.email_address;
        const orderId = order?.id || "—";
        if (buyerEmail) await sendEmailResend({ to: buyerEmail, orderId });
      }
    }

    res.statusCode = 200;
    return res.end("OK");
  } catch (e) {
    res.statusCode = 500;
    return res.end("Server error");
  }
};
