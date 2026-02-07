// api/paypal-webhook.js
// Webhook PayPal -> verifica firma -> (opcional) obtiene order -> envía email con Resend
// No pongas keys aquí: todo va por variables de entorno en Vercel.

function h(req, name) {
  return req.headers[name.toLowerCase()];
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : null;
}

function paypalBaseUrl() {
  const env = (process.env.PAYPAL_ENV || "sandbox").toLowerCase();
  return env === "sandbox"
    ? "https://api-m.sandbox.paypal.com"
    : "https://api-m.paypal.com";
}

async function paypalToken(baseUrl) {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_SECRET;

  if (!clientId || !secret) {
    throw new Error("Missing PAYPAL_CLIENT_ID or PAYPAL_SECRET");
  }

  const basic = Buffer.from(`${clientId}:${secret}`).toString("base64");

  const r = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`PayPal token error (${r.status}): ${t}`);
  }

  const data = await r.json();
  return data.access_token;
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

  const r = await fetch(`${baseUrl}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Verify signature error (${r.status}): ${t}`);
  }

  const data = await r.json();
  return data.verification_status === "SUCCESS";
}

function getOrderUrl(baseUrl, event) {
  // A veces el webhook trae link "up" al pedido
  const links = event?.resource?.links || [];
  const up = links.find((l) => l?.rel === "up" && l?.href);
  if (up?.href) return up.href;

  // Alternativa: order_id relacionado
  const orderId = event?.resource?.supplementary_data?.related_ids?.order_id;
  if (orderId) return `${baseUrl}/v2/checkout/orders/${orderId}`;

  return null;
}

async function fetchOrder(orderUrl, accessToken) {
  const r = await fetch(orderUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Order fetch error (${r.status}): ${t}`);
  }

  return r.json();
}

async function sendEmailResend({ to, orderId }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;

  if (!apiKey) throw new Error("Missing RESEND_API_KEY");
  if (!from) throw new Error("Missing MAIL_FROM");
  if (!to) throw new Error("Missing recipient email (to)");

  const replyTo = process.env.MAIL_REPLY_TO || "support@scootshop.co";

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from, // "Scoot Shop <support@scootshop.co>"
      to,
      subject: `Pedido confirmado — en preparación (#${orderId})`,
      text:
`Hola,
Hemos recibido tu pago correctamente. Tu pedido está confirmado y ya está en preparación.

Nº pedido: ${orderId}

Te avisaremos cuando salga enviado con su seguimiento.
Support — Scoot Shop`,
      reply_to: replyTo,
    }),
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Resend error (${r.status}): ${t}`);
  }
}

// Idempotencia básica (no persistente).
const processedEventIds = new Set();

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

    if (event.id && processedEventIds.has(event.id)) {
      res.statusCode = 200;
      return res.end("OK (duplicate ignored)");
    }

    const baseUrl = paypalBaseUrl();
    const token = await paypalToken(baseUrl);

    const signatureOk = await verifyWebhook(baseUrl, token, req, event);
    if (!signatureOk) {
      res.statusCode = 400;
      return res.end("Invalid signature");
    }

    if (event.id) processedEventIds.add(event.id);

    // Solo actuamos cuando el pago se completa
    if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
      const orderUrl = getOrderUrl(baseUrl, event);

      // Fallback de orderId si no podemos obtener el pedido
      let buyerEmail = null;
      let orderId =
        event?.resource?.supplementary_data?.related_ids?.order_id ||
        event?.resource?.id ||
        "—";

      // Si hay URL/ID de pedido, intentamos obtener email real del pagador
      if (orderUrl) {
        const order = await fetchOrder(orderUrl, token);
        buyerEmail = order?.payer?.email_address || null;
        orderId = order?.id || orderId;
      }

      // Para Sandbox: envía a tu correo real si defines TEST_EMAIL_TO en Vercel
      const to = process.env.TEST_EMAIL_TO || buyerEmail;

      console.log("WEBHOOK:", {
        event_type: event.event_type,
        orderUrl,
        buyerEmail,
        to,
        orderId,
      });

      if (to) {
        await sendEmailResend({ to, orderId });
      } else {
        console.log("No recipient email found; email not sent.");
      }
    } else {
      console.log("Ignored event_type:", event.event_type);
    }

    res.statusCode = 200;
    return res.end("OK");
  } catch (e) {
    console.error("Webhook error:", e?.message || e);
    res.statusCode = 500;
    return res.end("Server error");
  }
};
