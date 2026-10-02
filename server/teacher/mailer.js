// E-pochta yuborish (parolni tiklash). SMTP sozlanmagan bo'lsa — yuborilmaydi: dev rejimda havola konsolga chiqadi.
const nodemailer = require('nodemailer');

function createMailer(config, { log = console.log } = {}) {
  const s = config.smtp || {};
  const enabled = !!(s.host && s.from);
  let transport = null;
  const outbox = [];                       // testlar uchun (faqat dev)
  if (enabled) transport = nodemailer.createTransport({ host: s.host, port: s.port, secure: s.port === 465, auth: s.user ? { user: s.user, pass: s.password } : undefined });
  return {
    enabled,
    outbox,
    async send({ to, subject, text, html }) {
      if (!enabled) {
        if (!config.isProd) { outbox.push({ to, subject, text }); log(`✉️  [SMTP sozlanmagan] ${to}: ${subject}\n${text}`); if (outbox.length > 50) outbox.shift(); }
        return { sent: false };
      }
      await transport.sendMail({ from: s.from, to, subject, text, html });
      return { sent: true };
    },
  };
}
module.exports = { createMailer };
