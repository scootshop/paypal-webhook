// api/test-email.js
const { sendEmailResend } = require("../lib/email");

module.exports = async (req, res) => {
  try {
    // Solo GET (o POST si quieres). Mantengo GET para probar desde el navegador.
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET");
      return res.end("Method Not Allowed");
    }

    res.setHeader("Cache-Control", "no-store");

    // Seguridad por token
    const token = (req.query && req.query.token) || "";
    if (!process.env.TEST_EMAIL_TOKEN || token !== process.env.TEST_EMAIL_TOKEN) {
      res.statusCode = 401;
      return res.end("Unauthorized");
    }

    // Permite opcionalmente pasar ?to=... si quieres probar otros correos
    const to =
      (req.query && req.query.to) ||
      "jeanpierrepolo123456789@gmail.com";

    await sendEmailResend({
      to,
      orderId: "TEST-IX3-001",
      productName: "iScooter IX3",
      amountValue: "380.00",
      currencyCode: "EUR",
      productImageUrl: "https://scootshop.co/patinetes/series-ix/ix3/img/1.jpg",
      orderUrl: "https://scootshop.co/patinetes/series-ix/ix3/",
      bcc: (process.env.TEST_EMAIL_TO || "").trim() || undefined,
    });

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ ok: true, sentTo: to }));
  } catch (e) {
    console.log("test-email error:", e?.message || e);
    res.statusCode = 500;
    return res.end("Server error");
  }
};
