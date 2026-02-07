// api/paypal-webhook.js

function header(req, name) {
  const key = name.toLowerCase();
  const v = req.headers?.[key] ?? req.headers?.[name];
  // Vercel/Node normalmente lo da como string; por seguridad lo normalizamos
  return Array.isArray(v) ? v[0] : (v || "");
}

async function readEvent(req) {
  // Si algún runtime ya trae body parseado
  if (req.body) return typeof req.body === "string" ? JSON.parse(req.body) : req.body;

  const chunks = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : null;
}

function env(name, fallback = "") {
  return (process.env[name] ?? fallback).toString().trim();
}

async function paypalToken(baseUrl) {
  const clientId = env("PAYPAL_CLIENT_ID");
  const secret = env("PAYPAL_SECRET");

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
  console.log("paypalToken:", r.status, text.slice(0, 200));
  if (!r.ok) throw new Error(`paypal token error: ${r.status}`);
  return JSON.parse(text).access_token;
}

async function verifyWebhook(baseUrl, accessToken, req, event) {
  const payload = {
    auth_algo: header(req, "paypal-auth-algo"),
    cert_url: header(req, "paypal-cert-url"),
    transmission_id: header(req, "paypal-transmission-id"),
    transmission_sig: header(req, "paypal-transmission-sig"),
    transmission_time: header(req, "paypal-transmission-time"),
    webhook_id: env("PAYPAL_WEBHOOK_ID"),
    webhook_event: event,
  };

  const missing = Object.entries(payload)
    .filter(([k, v]) => k !== "webhook_event" && !v)
    .map(([k]) => k);

  // Logs CLAVE para cazar el fallo
  console.log("verify payload summary:", {
    missing,
    auth_algo: payload.auth_algo,
    cert_url_present: !!payload.cert_url,
    transmission_id_present: !!payload.transmission_id,
    transmission_time_present: !!payload.transmission_time,
    transmission_sig_len: (payload.transmission_sig || "").length,
    webhook_id: payload.webhook_id,
  });

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
  return { ok: data.verification_status === "SUCCESS", data, status: r.status, body: text };
}

async function sendEmailResend({ to, orderId }) {
  const mailFrom = env("MAIL_FROM");
  if (!mailFrom) throw new Error("MAIL_FROM is missing");

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env("RESEND_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: mailFrom,
      to,
      subject: `Pedido confirmado — en preparación (#${orderId})`,
      text: `Hola,
Hemos recibido tu pago correctamente. Tu pedido está confirmado y ya está en preparación.

Nº pedido: ${orderId}

Te avisaremos cuando salga enviado con su seguimiento.
Support — Scoot Shop`,
      // Resend usa replyTo (camelCase). :contentReference[oaicite:2]{index=2}
      replyTo: "support@scootshop.co",
    }),
  });

  const text = await r.text();
  console.log("resend:", r.status, text.slice(0, 300));
  if (!r.ok) throw new Error(`resend send error: ${r.status}`);
}

module.exports = async (req, res) => {
  try {
    // Evita ruido de GET /, favicon, etc.
    if (req.method === "GET") {
      res.statusCode = 200;
      return res.end("ok");
    }

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

    const paypalEnv = env("PAYPAL_ENV", "sandbox").toLowerCase();
    const baseUrl =
      paypalEnv === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

    console.log("paypal_env:", paypalEnv, "baseUrl:", baseUrl);

    const token = await paypalToken(baseUrl);

    const verify = await verifyWebhook(baseUrl, token, req, event);

    // Recomendación práctica mientras depuras:
    // devuelve 200 aunque falle la verificación, para que PayPal no reintente en bucle,
    // pero NO envíes email si no verifica.
    if (!verify.ok) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      return res.end(
        JSON.stringify({
          ok: false,
          reason: "Invalid signature",
          verification_status: verify?.data?.verification_status,
        })
      );
    }

    const toEmail = env("TEST_EMAIL_TO");
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
