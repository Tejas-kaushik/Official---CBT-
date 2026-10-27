import { SERVICES } from './content.js';

// Emails the studio when an enquiry arrives. Without SMTP settings it does nothing,
// and the enquiry is still saved and shown on the desk.
export function createNotifier(mail) {
  if (!mail.host) return { enabled: false, async enquiry() {} };

  let transport;
  const getTransport = async () => {
    if (!transport) {
      const { default: nodemailer } = await import('nodemailer');
      transport = nodemailer.createTransport({
        host: mail.host,
        port: mail.port,
        secure: mail.port === 465,
        auth: { user: mail.user, pass: mail.pass },
      });
    }
    return transport;
  };

  return {
    enabled: true,
    async enquiry(e) {
      const t = await getTransport();
      await t.sendMail({
        from: `"Content Book website" <${mail.user}>`,
        to: mail.to,
        replyTo: `"${e.name.replace(/"/g, '')}" <${e.email}>`,
        subject: `New enquiry: ${e.brand} (${SERVICES[e.service]})`,
        text: [
          `${e.name} from ${e.brand}${e.city ? `, ${e.city}` : ''} would like ${SERVICES[e.service]}.`,
          '',
          e.message ? `They wrote: ${e.message}` : 'They left no message.',
          '',
          `Reply to: ${e.email}`,
          `On the desk: /admin (enquiry #${e.id})`,
        ].join('\n'),
      });
    },
  };
}
