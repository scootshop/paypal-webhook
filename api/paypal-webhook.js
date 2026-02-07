// api/paypal-webhook.js
// Reemplaza TODO el archivo por este.
//
// Qué debes ajustar (solo variables en Vercel):
// - PAYPAL_ENV = "live"
// - PAYPAL_CLIENT_ID = (LIVE)
// - PAYPAL_SECRET = (LIVE)
// - PAYPAL_WEBHOOK_ID = (LIVE)  <-- del webhook creado en LIVE para ESTA URL
// - RESEND_API_KEY
// - MAIL_FROM  (ej: Scoot Shop <support@scootshop.co>)
// - TEST_EMAIL_TO (tu email real para la prueba)

function h(req, name) {
  // PayPal envía headers con nombres exactos; en Node vienen en minúsculas
  return req.headers[name.toLowerCase()];
}

async function readEvent(req) {
  // Si algún runtime ya trae body parseado
  if (req.body) {
    if (typeof req.body === "string") return JSON.parse(req.body);
    return req.body;
  }

  const chunks = [];
  for await (const c of req) {
    chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : null;
}

async function paypalToken(baseUrl) {
  const client = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_SECRET;

  if (!client || !secret) throw new Error("Missing PAYPAL_CLIENT_ID or PAYPAL_SECRET");

  const basic = Buffer.from(`${client}:${secret}`).toString("base64");

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

function pickBaseUrl() {
  const env = (process.env.PAYPAL_ENV || "sandbox").toLowerCase();
  return env === "sandbox"
    ? "https://api-m.sandbox.paypal.com"
    : "https://api-m.paypal.com";
}

async function verifyWebhook(baseUrl, accessToken, req, event) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) throw new Error("Missing PAYPAL_WEBHOOK_ID");

  const payload = {
    auth_algo: h(req, "paypal-auth-algo"),
    cert_url: h(req, "paypal-cert-url"),
    transmission_id: h(req, "paypal-transmission-id"),
    transmission_sig: h(req, "paypal-transmission-sig"),
    transmission_time: h(req, "paypal-transmission-time"),
    webhook_id: webhookId,
    webhook_event: event,
  };

  // Debug claro si faltan headers (si disparas desde navegador o Postman sin headers, fallará)
  const missing = Object.entries(payload)
    .filter(([k, v]) => k !== "webhook_event" && !v)
    .map(([k]) => k);

  if (missing.length) {
    console.log("Missing PayPal headers for signature verify:", missing);
    // Esto suele pasar si NO viene de PayPal (ej: test manual).
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

  if (!r.ok) {
    return { ok: false, httpStatus: r.status, raw: text, verification_status: null };
  }

  const data = JSON.parse(text);
  return {
    ok: data.verification_status === "SUCCESS",
    httpStatus: r.status,
    verification_status: data.verification_status,
    raw: text,
  };
}

async function sendEmailResend({ to, orderId, eventType }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;

  if (!apiKey) throw new Error("Missing RESEND_API_KEY");
  if (!from) throw new Error("Missing MAIL_FROM");
  if (!to) throw new Error("Missing recipient email");

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject: `Pago recibido — prueba real (#{${orderId}})`,
      text: `Hola,
Este es un email de prueba.

Evento: ${eventType}
Order/Resource ID: ${orderId}

Si has recibido esto, el webhook + Resend funcionan.
Scoot Shop`,
      reply_to: "support@scootshop.co",
    }),
  });

  const text = await r.text();
  console.log("resend:", r.status, text.slice(0, 300));
  if (!r.ok) throw new Error(`resend send error: ${r.status} ${text.slice(0, 200)}`);

  return text;
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

    const eventType = event.event_type || "unknown";
    console.log("event_type:", eventType);

    const baseUrl = pickBaseUrl();
    console.log("paypal_env:", (process.env.PAYPAL_ENV || "sandbox"), "baseUrl:", baseUrl);

    // 1) Token
    const token = await paypalToken(baseUrl);

    // 2) Verificación firma (esto es lo que te estaba devolviendo FAILURE)
    const verify = await verifyWebhook(baseUrl, token, req, event);

    if (!verify.ok) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      return res.end(
        JSON.stringify({
          ok: false,
          reason: "Invalid signature",
          verification_status: verify.verification_status,
          verify_http_status: verify.httpStatus,
          // Importante: si aquí sale FAILURE, es porque PAYPAL_WEBHOOK_ID no corresponde al webhook
          // LIVE que PayPal está usando para firmar este evento.
          verify_raw: (verify.raw || "").slice(0, 500),
        })
      );
    }

    // 3) Enviar email de prueba SIEMPRE (para confirmar funcionamiento)
    const toEmail = process.env.TEST_EMAIL_TO;
    if (!toEmail) {
      console.log("TEST_EMAIL_TO not set; skipping email send.");
    } else {
      const idForEmail =
        event?.resource?.id ||
        event?.id ||
        event?.resource?.supplementary_data?.related_ids?.order_id ||
        "—";

      await sendEmailResend({ to: toEmail, orderId: idForEmail, eventType });
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ ok: true }));
  } catch (e) {
    console.log("Server error:", e?.stack || e?.message || e);
    res.statusCode = 500;
    return res.end("Server error");
  }
};
