// api/paypal-webhook.js

function h(req, name) {
  return req.headers[name.toLowerCase()];
}

async function readEvent(req) {
  // Por si algún runtime ya trae body parseado
  if (req.body) return typeof req.body === "string" ? JSON.parse(req.body) : req.body;

  const chunks = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
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

  const missing = Object.entries(payload)
    .filter(([k, v]) => k !== "webhook_event" && !v)
    .map(([k]) => k);

  if (missing.length) {
    console.log("Missing verify fields:", missing);
  }

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

async function sendEmailResend({ to, orderId }) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.MAIL_FROM,
      to,
      subject: `Pedido confirmado — en preparación (#${orderId})`,
      text: `Hola,
Hemos recibido tu pago correctamente. Tu pedido está confirmado y ya está en preparación.

Nº pedido: ${orderId}

Te avisaremos cuando salga enviado con su seguimiento.
Support — Scoot Shop`,
      reply_to: "support@scootshop.co",
    }),
  });

  const text = await r.text();
  console.log("resend:", r.status, text.slice(0, 300));
  if (!r.ok) throw new Error(`resend send error: ${r.status}`);
}

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

    const env = (process.env.PAYPAL_ENV || "sandbox").toLowerCase();
    const baseUrl =
      env === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";

    const token = await paypalToken(baseUrl);

    const verify = await verifyWebhook(baseUrl, token, req, event);
    if (!verify.ok) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      return res.end(
        JSON.stringify({
          ok: false,
          reason: "Invalid signature",
          verifyStatus: verify.status,
          verifyBody: (verify.body || "").slice(0, 500),
        })
      );
    }

    // Para pruebas: fuerza siempre a tu email real si existe
    const toEmail = process.env.TEST_EMAIL_TO;

    if (toEmail) {
      await sendEmailResend({ to: toEmail, orderId: event?.id || "—" });
    } else {
      console.log("TEST_EMAIL_TO not set; skipping email send.");
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ ok: true }));
  } catch (e) {
    console.log("Server error:", e?.message || e);
    res.statusCode = 500;
    return res.end("Server error");
  }
};
