// api/paypal-webhook.js

function h(req, name) {
  const key = name.toLowerCase();
  return req.headers?.[key] ?? null;
}

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function readEvent(req) {
  // Si algún runtime ya trae body parseado
  if (req.body) return typeof req.body === "string" ? JSON.parse(req.body) : req.body;

  const chunks = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : null;
}

function paypalBaseUrl() {
  const env = (process.env.PAYPAL_ENV || "sandbox").toLowerCase();
  // Acepta "live" o "production"
  if (env === "live" || env === "production") return "https://api-m.paypal.com";
  return "https://api-m.sandbox.paypal.com";
}

async function paypalToken(baseUrl) {
  const clientId = mustEnv("PAYPAL_CLIENT_ID");
  const secret = mustEnv("PAYPAL_SECRET");

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
  if (!r.ok) throw new Error(`paypal token error: ${r.status} ${text.slice(0, 200)}`);

  return JSON.parse(text).access_token;
}

/**
 * PRUEBA DEFINITIVA:
 * Confirma que PAYPAL_WEBHOOK_ID pertenece al MISMO APP/ENTORNO de tu token.
 */
async function assertWebhookIdBelongsToThisApp(baseUrl, accessToken, webhookId) {
  const r = await fetch(`${baseUrl}/v1/notifications/webhooks/${encodeURIComponent(webhookId)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  const text = await r.text();
  console.log("get-webhook:", r.status, text.slice(0, 250));

  if (!r.ok) {
    throw new Error(
      `PAYPAL_WEBHOOK_ID not found for these credentials (status ${r.status}). ` +
      `This means webhook_id is from another App or another environment.`
    );
  }
}

async function verifyWebhook(baseUrl, accessToken, req, event) {
  const webhookId = mustEnv("PAYPAL_WEBHOOK_ID");

  const payload = {
    auth_algo: h(req, "paypal-auth-algo"),
    cert_url: h(req, "paypal-cert-url"),
    transmission_id: h(req, "paypal-transmission-id"),
    transmission_sig: h(req, "paypal-transmission-sig"),
    transmission_time: h(req, "paypal-transmission-time"),
    webhook_id: webhookId,
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
  console.log("verify-webhook-signature:", r.status, text.slice(0, 300));

  if (!r.ok) return { ok: false, httpStatus: r.status, raw: text };

  const data = JSON.parse(text);
  return { ok: data.verification_status === "SUCCESS", data };
}

async function sendEmailResend({ to, orderId }) {
  const apiKey = mustEnv("RESEND_API_KEY");
  const from = mustEnv("MAIL_FROM");

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,                 // <- aquí decides el FROM
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
  console.log("resend:", r.status, text.slice(0, 200));
  if (!r.ok) throw new Error(`resend send error: ${r.status} ${text.slice(0, 200)}`);
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

    const baseUrl = paypalBaseUrl();
    console.log("event_type:", event.event_type);
    console.log("paypal_env:", process.env.PAYPAL_ENV, "baseUrl:", baseUrl);

    const token = await paypalToken(baseUrl);

    // 🔥 PRUEBA DEFINITIVA: si aquí peta, tienes webhook_id de otro App/entorno.
    await assertWebhookIdBelongsToThisApp(baseUrl, token, mustEnv("PAYPAL_WEBHOOK_ID"));

    const verify = await verifyWebhook(baseUrl, token, req, event);
    if (!verify.ok) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      return res.end(
        JSON.stringify({
          ok: false,
          reason: "Invalid signature",
          verification_status: verify.data?.verification_status,
        })
      );
    }

    // Email (no bloquea el 200 si falla, para no “romper” PayPal)
    let emailSent = false;
    const toEmail = process.env.TEST_EMAIL_TO;
    if (toEmail) {
      try {
        await sendEmailResend({ to: toEmail, orderId: event?.resource?.id || event?.id || "—" });
        emailSent = true;
      } catch (e) {
        console.log("Email error:", e?.message || e);
      }
    } else {
      console.log("TEST_EMAIL_TO not set; skipping email send.");
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ ok: true, emailSent }));
  } catch (e) {
    console.log("Server error:", e?.message || e);
    res.statusCode = 500;
    return res.end("Server error");
  }
};
