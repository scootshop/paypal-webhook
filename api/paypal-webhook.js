// api/paypal-webhook.js

function h(req, name) {
  return req.headers[name.toLowerCase()];
}

async function readEvent(req) {
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

// Lee detalles del pedido para sacar email del comprador (payer.email_address)
async function getOrderDetails(baseUrl, accessToken, orderId) {
  const r = await fetch(`${baseUrl}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const text = await r.text();
  console.log("getOrderDetails:", r.status, text.slice(0, 200));
  if (!r.ok) throw new Error(`get order error: ${r.status}`);
  return JSON.parse(text);
}

function extractOrderIdFromEvent(event) {
  // En PAYMENT.CAPTURE.COMPLETED suele venir aquí:
  return (
    event?.resource?.supplementary_data?.related_ids?.order_id ||
    event?.resource?.supplementary_data?.related_ids?.checkout_order_id ||
    null
  );
}

function extractBuyerEmailDirect(event) {
  // A veces viene directo en eventos de ORDER.*
  return event?.resource?.payer?.email_address || null;
}

async function sendEmailResend({ to, bcc, orderId }) {
  const payload = {
    from: process.env.MAIL_FROM, // ej: Scoot Shop <support@scootshop.co>
    to,
    subject: `Pedido confirmado — en preparación (#${orderId})`,
    text: `Hola,
Hemos recibido tu pago correctamente. Tu pedido está confirmado y ya está en preparación.

Nº pedido: ${orderId}

Te avisaremos cuando salga enviado con su seguimiento.
Support — Scoot Shop`,
    reply_to: "support@scootshop.co",
  };

  if (bcc) payload.bcc = [bcc];

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
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

    const env = (process.env.PAYPAL_ENV || "live").toLowerCase();
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
        })
      );
    }

    // Solo enviar email cuando el pago está completado
    const isPaid =
      event.event_type === "PAYMENT.CAPTURE.COMPLETED" ||
      event.event_type === "CHECKOUT.ORDER.COMPLETED";

    if (!isPaid) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ ok: true, skipped: true, reason: "not a paid event" }));
    }

    // 1) Intento email directo
    let buyerEmail = extractBuyerEmailDirect(event);

    // 2) Si no viene, saco orderId y pido el order a PayPal (ahí sí viene payer.email_address)
    if (!buyerEmail) {
      const orderId = extractOrderIdFromEvent(event);
      if (orderId) {
        const order = await getOrderDetails(baseUrl, token, orderId);
        buyerEmail = order?.payer?.email_address || null;
      }
    }

    // Si sigue sin email, no rompas el webhook: devuelve 200 y loguea
    if (!buyerEmail) {
      console.log("No buyer email found; no email sent.");
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ ok: true, sent: false, reason: "missing buyer email" }));
    }

    // ✅ TEST_EMAIL_TO ahora es BCC (copia para ti), NO reemplaza al comprador
    const bcc = process.env.TEST_EMAIL_TO || "";

    // Identificador para el email (usa orderId si existe, sino id del evento)
    const orderIdForMail =
      extractOrderIdFromEvent(event) ||
      event?.resource?.id ||
      event?.id ||
      "—";

    await sendEmailResend({
      to: buyerEmail,
      bcc: bcc || undefined,
      orderId: orderIdForMail,
    });

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ ok: true, sentTo: buyerEmail, bcc: !!bcc }));
  } catch (e) {
    console.log("Server error:", e?.message || e);
    res.statusCode = 500;
    return res.end("Server error");
  }
};
