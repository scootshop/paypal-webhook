const { sendEmailResend } = require("../lib/email");

function readAuthBearer(req) {
  const header = req.headers?.authorization || "";
  const parts = header.split(" ");
  if (parts.length === 2 && parts[0] === "Bearer") {
    return parts[1].trim();
  }
  return "";
}

async function readJson(req) {
  if (req.body) {
    if (typeof req.body === "string") return JSON.parse(req.body);
    return req.body;
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function normalizeUrl(value, fallback = "https://scootshop.co/") {
  const input = String(value || "").trim();
  if (!input) return fallback;
  if (/^https?:\/\//i.test(input)) return input;
  return "https://scootshop.co" + (input.startsWith("/") ? input : "/" + input);
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Allow", "POST");
      return res.end("Method Not Allowed");
    }

    const bearer = readAuthBearer(req);
    if (!process.env.VERCEL_EMAIL_BEARER_TOKEN || bearer !== process.env.VERCEL_EMAIL_BEARER_TOKEN) {
      res.statusCode = 401;
      return res.end("Unauthorized");
    }

    const body = await readJson(req);

    const event = String(body.event || "").trim();
    const orderId = String(body.orderId || "").trim();
    const payerEmail = String(body.payerEmail || "").trim();
    const subject = String(body.subject || "").trim();
    const context = body.context && typeof body.context === "object" ? body.context : {};

    if (event !== "payment.paid") {
      res.statusCode = 400;
      return res.end("Unsupported event");
    }

    if (!orderId || !payerEmail) {
      res.statusCode = 400;
      return res.end("Missing orderId or payerEmail");
    }

    const productName = String(
      context.productName ||
      context.name ||
      context.sku ||
      "Pedido Scoot Shop"
    ).trim();

    let amountValue = "";
    if (typeof context.grossAmount === "string" && context.grossAmount.trim()) {
      amountValue = context.grossAmount.trim();
    } else if (Number.isFinite(context.amountTotal)) {
      amountValue = (Number(context.amountTotal) / 100).toFixed(2);
    }

    const currencyCode = String(context.currency || "EUR").trim().toUpperCase();

    const productImageUrl = normalizeUrl(
      context.productImageUrl || body.productImageUrl || "/patinetes/series-ix/ix3/img/1.jpg"
    );

    const orderUrl = normalizeUrl(
      context.orderUrl || body.orderUrl || "/pedido/"
    );

    await sendEmailResend({
      to: payerEmail,
      bcc: process.env.TEST_EMAIL_TO || undefined,
      orderId,
      productName,
      amountValue,
      currencyCode,
      productImageUrl,
      orderUrl,
    });

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ ok: true }));
  } catch (e) {
    console.error("payment-confirmation error:", e);
    res.statusCode = 500;
    return res.end("Server error");
  }
};
