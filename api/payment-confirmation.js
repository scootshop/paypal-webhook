const { sendRawEmailResend } = require("../lib/email");

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

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Allow", "POST");
      return res.end("Method Not Allowed");
    }

    const bearer = readAuthBearer(req);
    if (
      !process.env.VERCEL_EMAIL_BEARER_TOKEN ||
      bearer !== process.env.VERCEL_EMAIL_BEARER_TOKEN
    ) {
      res.statusCode = 401;
      return res.end("Unauthorized");
    }

    const body = await readJson(req);

    const event = String(body.event || "").trim();
    const orderId = String(body.orderId || "").trim();
    const payerEmail = String(body.payerEmail || "").trim();
    const subject = String(body.subject || "").trim();

    if (!orderId || !payerEmail) {
      res.statusCode = 400;
      return res.end("Missing orderId or payerEmail");
    }

    // All events (including payment.paid) relay the HTML/text from PHP backend
    const htmlBody = String(body.html || "").trim();
    const textBody = String(body.text || "").trim();
    const emailSubject =
      subject || `SCOOT SHOP — Actualización de pedido #${orderId}`;

    if (!htmlBody && !textBody) {
      res.statusCode = 400;
      return res.end("Missing html or text body");
    }

    await sendRawEmailResend({
      to: payerEmail,
      bcc: process.env.TEST_EMAIL_TO || undefined,
      subject: emailSubject,
      html: htmlBody || undefined,
      text: textBody,
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
