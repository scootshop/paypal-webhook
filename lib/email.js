// lib/email.js
// Plantilla PRO + envío con Resend (HTML + texto fallback)

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatMoney(value, currency) {
  const v = Number(value);
  if (!Number.isFinite(v)) return `${value || ""} ${currency || "EUR"}`.trim();
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: currency || "EUR",
  }).format(v);
}

function renderOrderEmailHTML({
  orderId,
  productName,
  amountValue,
  currencyCode,
  productImageUrl,
  orderUrl,
}) {
  const BRAND_NAME = "SCOOT SHOP";
  const BRAND_URL = "https://scootshop.co/";
  const LOGO_URL = "https://scootshop.co/img/0-removebg-preview.png";
  const SUPPORT_EMAIL = "support@scootshop.co";
  const WHATSAPP_URL =
    "https://wa.me/34666318747?text=" +
    encodeURIComponent(`Hola! Tengo una consulta sobre mi pedido #${orderId}`);

  const safeOrderId = escapeHtml(orderId || "—");
  const safeProduct = escapeHtml(productName || "Tu pedido");
  const safeAmount =
    amountValue && currencyCode ? escapeHtml(formatMoney(amountValue, currencyCode)) : "";
  const safeProductImg = productImageUrl
    ? escapeHtml(productImageUrl)
    : "https://scootshop.co/patinetes/series-ix/ix3/img/1.jpg";// lib/email.js
// Plantilla PRO + envío con Resend (HTML + texto fallback)
// Logo real: https://scootshop.co/img/0.png

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatMoney(value, currency) {
  const v = Number(value);
  if (!Number.isFinite(v)) return `${value || ""} ${currency || "EUR"}`.trim();
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: currency || "EUR",
  }).format(v);
}

function renderOrderEmailHTML({
  orderId,
  productName,
  amountValue,
  currencyCode,
  productImageUrl,
  orderUrl,
}) {
  const BRAND_NAME = "SCOOT SHOP";
  const BRAND_URL = "https://scootshop.co/";
  const LOGO_URL = "https://scootshop.co/img/0.jpg"; // ✅ ruta real
  const SUPPORT_EMAIL = "support@scootshop.co";
  const WHATSAPP_URL =
    "https://wa.me/34666318747?text=" +
    encodeURIComponent(`Hola! Tengo una consulta sobre mi pedido #${orderId}`);

  const safeOrderId = escapeHtml(orderId || "—");
  const safeProduct = escapeHtml(productName || "Tu pedido");
  const safeAmount =
    amountValue && currencyCode ? escapeHtml(formatMoney(amountValue, currencyCode)) : "";

  const safeProductImg = productImageUrl
    ? escapeHtml(productImageUrl)
    : "https://scootshop.co/patinetes/series-ix/ix3/img/1.jpg";

  const primaryCtaUrl = orderUrl ? escapeHtml(orderUrl) : BRAND_URL;
  const year = new Date().getFullYear();

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <title>Pedido confirmado</title>
</head>
<body style="margin:0;padding:0;background:#F3F5F9;">
  <!-- Preheader (oculto) -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
    Pedido confirmado. Estamos preparando tu envío.
  </div>

  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#F3F5F9;padding:24px 0;">
    <tr>
      <td align="center" style="padding:0 12px;">
        <table role="presentation" width="640" cellspacing="0" cellpadding="0" border="0" style="max-width:640px;width:100%;">

          <!-- Top gradient bar -->
          <tr>
            <td style="background:linear-gradient(90deg,#111827,#1F2937);border-radius:18px 18px 0 0;padding:18px 18px 12px 18px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td align="left" style="vertical-align:middle;">
                    <a href="${BRAND_URL}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;">
                      <img src="${LOGO_URL}" width="140" alt="${BRAND_NAME}" style="display:block;border:0;outline:none;height:auto;">
                    </a>
                  </td>
                  <td align="right" style="vertical-align:middle;font-family:Arial,Helvetica,sans-serif;color:#D1D5DB;font-size:12px;">
                    Confirmación de compra
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main card -->
          <tr>
            <td style="background:#FFFFFF;border-radius:0 0 18px 18px;box-shadow:0 10px 30px rgba(16,24,40,.10);padding:22px 18px 18px 18px;">

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="font-family:Arial,Helvetica,sans-serif;">
                    <div style="font-size:22px;line-height:1.25;font-weight:800;color:#111827;margin:0;">
                      Pedido confirmado
                    </div>
                    <div style="font-size:14px;line-height:1.6;color:#374151;margin-top:6px;">
                      Hemos recibido tu pago correctamente. Tu pedido está confirmado y ya está en preparación.
                    </div>
                  </td>
                </tr>
              </table>

              <!-- Product row -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:16px;border:1px solid #EEF2F7;border-radius:14px;">
                <tr>
                  <td style="padding:14px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td width="86" style="vertical-align:top;">
                          <img src="${safeProductImg}" width="86" height="86" alt="${safeProduct}" style="display:block;border-radius:12px;object-fit:cover;border:0;">
                        </td>
                        <td style="padding-left:12px;vertical-align:top;font-family:Arial,Helvetica,sans-serif;">
                          <div style="font-size:12px;color:#6B7280;margin-bottom:4px;">Artículo</div>
                          <div style="font-size:15px;color:#111827;font-weight:800;line-height:1.35;">${safeProduct}</div>

                          <div style="margin-top:10px;display:block;">
                            <span style="display:inline-block;background:#F9FAFB;border:1px solid #EEF2F7;border-radius:999px;padding:6px 10px;font-size:12px;color:#111827;font-weight:700;">
                              Nº pedido: #${safeOrderId}
                            </span>
                            ${
                              safeAmount
                                ? `<span style="display:inline-block;margin-left:8px;background:#F9FAFB;border:1px solid #EEF2F7;border-radius:999px;padding:6px 10px;font-size:12px;color:#111827;font-weight:800;">
                                     Total: ${safeAmount}
                                   </span>`
                                : ""
                            }
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- CTA -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:16px;">
                <tr>
                  <td align="left">
                    <a href="${primaryCtaUrl}" target="_blank" rel="noopener noreferrer"
                       style="display:inline-block;background:#111827;color:#FFFFFF;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:800;padding:12px 16px;border-radius:12px;">
                      Ir a Scoot Shop
                    </a>
                    <a href="${WHATSAPP_URL}" target="_blank" rel="noopener noreferrer"
                       style="display:inline-block;margin-left:10px;background:#F3F4F6;color:#111827;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:800;padding:12px 16px;border-radius:12px;border:1px solid #E5E7EB;">
                      WhatsApp soporte
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Next steps -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:18px;background:#F9FAFB;border:1px solid #EEF2F7;border-radius:14px;">
                <tr>
                  <td style="padding:14px 14px 12px 14px;font-family:Arial,Helvetica,sans-serif;">
                    <div style="font-size:13px;font-weight:800;color:#111827;">Próximos pasos</div>
                    <div style="font-size:13px;line-height:1.7;color:#374151;margin-top:6px;">
                      • Preparación: <b>1 día hábil</b><br>
                      • Entrega estimada: <b>5–7 días hábiles</b><br>
                      • Te avisaremos cuando salga enviado con su seguimiento.
                    </div>
                  </td>
                </tr>
              </table>

              <!-- Support -->
              <div style="margin-top:14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.7;color:#6B7280;">
                Si necesitas ayuda, responde a este correo o escribe a
                <a href="mailto:${SUPPORT_EMAIL}" style="color:#111827;text-decoration:underline;">${SUPPORT_EMAIL}</a>.
              </div>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:14px 6px 0 6px;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#9CA3AF;">
              © ${year} ${BRAND_NAME} · Compra segura
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function sendEmailResend({
  to,
  bcc,
  orderId,
  productName,
  amountValue,
  currencyCode,
  productImageUrl,
  orderUrl,
}) {
  const html = renderOrderEmailHTML({
    orderId,
    productName,
    amountValue,
    currencyCode,
    productImageUrl,
    orderUrl,
  });

  const text =
`Pedido confirmado — SCOOT SHOP

Hemos recibido tu pago correctamente. Tu pedido está confirmado y ya está en preparación.

Nº pedido: #${orderId || "—"}
Artículo: ${productName || "Tu pedido"}
${amountValue && currencyCode ? `Total: ${formatMoney(amountValue, currencyCode)}` : ""}

Preparación: 1 día hábil
Entrega estimada: 5–7 días hábiles

Soporte: support@scootshop.co`;

  const payload = {
    from: process.env.MAIL_FROM,
    to,
    subject: `Pedido confirmado — en preparación (#${orderId || "—"})`,
    html,
    text,
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

  const out = await r.text();
  console.log("resend:", r.status, out.slice(0, 300));
  if (!r.ok) throw new Error(`resend send error: ${r.status}`);
}

module.exports = {
  escapeHtml,
  formatMoney,
  renderOrderEmailHTML,
  sendEmailResend,
};


  const primaryCtaUrl = orderUrl ? escapeHtml(orderUrl) : BRAND_URL;
  const year = new Date().getFullYear();

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <title>Pedido confirmado</title>
</head>
<body style="margin:0;padding:0;background:#F3F5F9;">
  <!-- Preheader (oculto) -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
    Pedido confirmado. Estamos preparando tu envío.
  </div>

  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#F3F5F9;padding:24px 0;">
    <tr>
      <td align="center" style="padding:0 12px;">
        <table role="presentation" width="640" cellspacing="0" cellpadding="0" border="0" style="max-width:640px;width:100%;">

          <!-- Top gradient bar -->
          <tr>
            <td style="background:linear-gradient(90deg,#111827,#1F2937);border-radius:18px 18px 0 0;padding:18px 18px 12px 18px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td align="left" style="vertical-align:middle;">
                    <a href="${BRAND_URL}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;">
                      <img src="${LOGO_URL}" width="140" alt="${BRAND_NAME}" style="display:block;border:0;outline:none;height:auto;">
                    </a>
                  </td>
                  <td align="right" style="vertical-align:middle;font-family:Arial,Helvetica,sans-serif;color:#D1D5DB;font-size:12px;">
                    Confirmación de compra
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main card -->
          <tr>
            <td style="background:#FFFFFF;border-radius:0 0 18px 18px;box-shadow:0 10px 30px rgba(16,24,40,.10);padding:22px 18px 18px 18px;">

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="font-family:Arial,Helvetica,sans-serif;">
                    <div style="font-size:22px;line-height:1.25;font-weight:800;color:#111827;margin:0;">
                      Pedido confirmado
                    </div>
                    <div style="font-size:14px;line-height:1.6;color:#374151;margin-top:6px;">
                      Hemos recibido tu pago correctamente. Tu pedido está confirmado y ya está en preparación.
                    </div>
                  </td>
                </tr>
              </table>

              <!-- Product row -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:16px;border:1px solid #EEF2F7;border-radius:14px;">
                <tr>
                  <td style="padding:14px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td width="86" style="vertical-align:top;">
                          <img src="${safeProductImg}" width="86" height="86" alt="${safeProduct}" style="display:block;border-radius:12px;object-fit:cover;border:0;">
                        </td>
                        <td style="padding-left:12px;vertical-align:top;font-family:Arial,Helvetica,sans-serif;">
                          <div style="font-size:12px;color:#6B7280;margin-bottom:4px;">Artículo</div>
                          <div style="font-size:15px;color:#111827;font-weight:800;line-height:1.35;">${safeProduct}</div>

                          <div style="margin-top:10px;display:block;">
                            <span style="display:inline-block;background:#F9FAFB;border:1px solid #EEF2F7;border-radius:999px;padding:6px 10px;font-size:12px;color:#111827;font-weight:700;">
                              Nº pedido: #${safeOrderId}
                            </span>
                            ${
                              safeAmount
                                ? `<span style="display:inline-block;margin-left:8px;background:#F9FAFB;border:1px solid #EEF2F7;border-radius:999px;padding:6px 10px;font-size:12px;color:#111827;font-weight:800;">
                                     Total: ${safeAmount}
                                   </span>`
                                : ""
                            }
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- CTA -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:16px;">
                <tr>
                  <td align="left">
                    <a href="${primaryCtaUrl}" target="_blank" rel="noopener noreferrer"
                       style="display:inline-block;background:#111827;color:#FFFFFF;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:800;padding:12px 16px;border-radius:12px;">
                      Ir a Scoot Shop
                    </a>
                    <a href="${WHATSAPP_URL}" target="_blank" rel="noopener noreferrer"
                       style="display:inline-block;margin-left:10px;background:#F3F4F6;color:#111827;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:800;padding:12px 16px;border-radius:12px;border:1px solid #E5E7EB;">
                      WhatsApp soporte
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Next steps -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:18px;background:#F9FAFB;border:1px solid #EEF2F7;border-radius:14px;">
                <tr>
                  <td style="padding:14px 14px 12px 14px;font-family:Arial,Helvetica,sans-serif;">
                    <div style="font-size:13px;font-weight:800;color:#111827;">Próximos pasos</div>
                    <div style="font-size:13px;line-height:1.7;color:#374151;margin-top:6px;">
                      • Preparación: <b>1 día hábil</b><br>
                      • Entrega estimada: <b>5–7 días hábiles</b><br>
                      • Te avisaremos cuando salga enviado con su seguimiento.
                    </div>
                  </td>
                </tr>
              </table>

              <!-- Support -->
              <div style="margin-top:14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.7;color:#6B7280;">
                Si necesitas ayuda, responde a este correo o escribe a
                <a href="mailto:${SUPPORT_EMAIL}" style="color:#111827;text-decoration:underline;">${SUPPORT_EMAIL}</a>.
              </div>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:14px 6px 0 6px;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#9CA3AF;">
              © ${year} ${BRAND_NAME} · Compra segura
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function sendEmailResend({
  to,
  bcc,
  orderId,
  productName,
  amountValue,
  currencyCode,
  productImageUrl,
  orderUrl,
}) {
  const html = renderOrderEmailHTML({
    orderId,
    productName,
    amountValue,
    currencyCode,
    productImageUrl,
    orderUrl,
  });

  const text =
`Pedido confirmado — SCOOT SHOP

Hemos recibido tu pago correctamente. Tu pedido está confirmado y ya está en preparación.

Nº pedido: #${orderId || "—"}
Artículo: ${productName || "Tu pedido"}
${amountValue && currencyCode ? `Total: ${formatMoney(amountValue, currencyCode)}` : ""}

Preparación: 1 día hábil
Entrega estimada: 5–7 días hábiles

Soporte: support@scootshop.co`;

  const payload = {
    from: process.env.MAIL_FROM, // ej: Scoot Shop <support@scootshop.co>
    to,
    subject: `Pedido confirmado — en preparación (#${orderId || "—"})`,
    html,
    text,
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

  const out = await r.text();
  console.log("resend:", r.status, out.slice(0, 300));
  if (!r.ok) throw new Error(`resend send error: ${r.status}`);
}

module.exports = {
  escapeHtml,
  formatMoney,
  renderOrderEmailHTML,
  sendEmailResend,
};
