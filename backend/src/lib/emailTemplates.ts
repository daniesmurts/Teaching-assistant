import type { EmailPayload } from '../services/emailTransport'

// ─── Base layout ──────────────────────────────────────────────────────────────

function wrap(body: string): string {
  return `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F7F5F0;font-family:Arial,sans-serif">
  <div style="max-width:560px;margin:32px auto;background:#fff;border:1px solid rgba(0,0,0,0.08);border-radius:10px;overflow:hidden">
    <div style="padding:20px 28px;border-bottom:1px solid rgba(0,0,0,0.08)">
      <span style="font-size:18px;font-weight:700;color:#1A1A1A;font-family:Georgia,serif">
        ИС<span style="color:#C8860A">ПУМ</span>
      </span>
    </div>
    <div style="padding:28px;font-size:15px;line-height:1.7;color:#1A1A1A">
      ${body}
    </div>
    <div style="padding:16px 28px;border-top:1px solid rgba(0,0,0,0.08);font-size:12px;color:#A09890">
      ИСПУМ · ispum.ru<br>
      Если вы не ожидали это письмо, просто проигнорируйте его.
    </div>
  </div>
</body>
</html>`
}

function btn(href: string, label: string): string {
  return `<p style="margin:20px 0">
    <a href="${href}"
       style="display:inline-block;padding:10px 22px;background:#C8860A;color:#fff;
              text-decoration:none;border-radius:8px;font-weight:500;font-size:14px">
      ${label}
    </a>
  </p>`
}

function firstName(name: string): string {
  return name.split(' ').find(w => w.length > 1) ?? name.split(' ')[0] ?? name
}

function billingBtn(): string {
  return btn(`${process.env.FRONTEND_URL ?? ''}/billing`, 'Обновить способ оплаты')
}

function fmtRu(d: Date): string {
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

// ─── Renewal failed (grace period) ────────────────────────────────────────────

export function renewalFailedEmail(name: string, accessUntil: Date): Omit<EmailPayload, 'to'> {
  const fn = firstName(name)
  return {
    subject: 'Не удалось продлить подписку ИСПУМ',
    html: wrap(`
      <p>Здравствуйте, ${fn}!</p>
      <p>Мы не смогли списать оплату за продление подписки <strong>ИСПУМ Pro</strong> —
         возможно, у карты истёк срок действия или недостаточно средств.</p>
      <p>Доступ к Pro сохраняется до <strong>${fmtRu(accessUntil)}</strong>.
         Пожалуйста, обновите способ оплаты, чтобы не потерять доступ.</p>
      ${billingBtn()}
      <p style="color:#6B6560;font-size:13px">
        Мы повторим попытку списания автоматически в течение следующих дней.
      </p>
    `),
    text:
      `Здравствуйте, ${fn}!\n\nНе удалось списать оплату за продление ИСПУМ Pro.\n` +
      `Доступ сохраняется до ${fmtRu(accessUntil)}. Обновите карту: ${process.env.FRONTEND_URL ?? ''}/billing\n\nИСПУМ · ispum.ru`,
  }
}

// ─── Subscription ended ───────────────────────────────────────────────────────

export function subscriptionEndedEmail(name: string): Omit<EmailPayload, 'to'> {
  const fn = firstName(name)
  return {
    subject: 'Подписка ИСПУМ Pro завершена',
    html: wrap(`
      <p>Здравствуйте, ${fn}!</p>
      <p>Подписка <strong>ИСПУМ Pro</strong> завершена, так как не удалось продлить оплату.
         Ваш аккаунт переведён на бесплатный тариф.</p>
      <p>Вы можете вернуться к Pro в любой момент — все ваши данные сохранены.</p>
      ${btn(`${process.env.FRONTEND_URL ?? ''}/billing`, 'Возобновить Pro')}
    `),
    text:
      `Здравствуйте, ${fn}!\n\nПодписка ИСПУМ Pro завершена. Аккаунт переведён на бесплатный тариф.\n` +
      `Возобновить: ${process.env.FRONTEND_URL ?? ''}/billing\n\nИСПУМ · ispum.ru`,
  }
}

// ─── Registration confirmation ────────────────────────────────────────────────

export function registrationEmail(name: string): Omit<EmailPayload, 'to'> {
  const fn  = firstName(name)
  const url = `${process.env.FRONTEND_URL ?? ''}/dashboard`
  return {
    subject: 'Добро пожаловать в ИСПУМ',
    html: wrap(`
      <p>Здравствуйте, ${fn}!</p>
      <p>Ваш аккаунт ИСПУМ создан. Вы готовы приступить к работе.</p>
      ${btn(url, 'Перейти в ИСПУМ')}
      <p style="color:#6B6560;font-size:13px">
        Бесплатный план включает 20 проверок работ и 3 презентации в месяц.<br>
        Перейдите на Pro для неограниченного доступа.
      </p>
    `),
    text:
      `Здравствуйте, ${fn}!\n\nВаш аккаунт ИСПУМ создан.\n\n` +
      `Перейти в ИСПУМ: ${url}\n\nИСПУМ · ispum.ru`,
  }
}

// ─── Password reset ───────────────────────────────────────────────────────────

export function passwordResetEmail(
  name: string,
  resetUrl: string
): Omit<EmailPayload, 'to'> {
  const fn = firstName(name)
  return {
    subject: 'Сброс пароля ИСПУМ',
    html: wrap(`
      <p>Здравствуйте, ${fn}!</p>
      <p>Мы получили запрос на сброс пароля для вашего аккаунта.</p>
      ${btn(resetUrl, 'Сбросить пароль')}
      <p style="color:#6B6560;font-size:13px">
        Ссылка действительна в течение <strong>1 часа</strong>.<br>
        Если вы не запрашивали сброс пароля, просто проигнорируйте это письмо —
        ваш пароль не изменится.
      </p>
    `),
    text:
      `Здравствуйте, ${fn}!\n\n` +
      `Для сброса пароля перейдите по ссылке:\n${resetUrl}\n\n` +
      `Ссылка действительна 1 час.\n\nИСПУМ · ispum.ru`,
  }
}

// ─── Password changed confirmation ───────────────────────────────────────────

export function passwordChangedEmail(name: string): Omit<EmailPayload, 'to'> {
  const fn = firstName(name)
  return {
    subject: 'Пароль ИСПУМ изменён',
    html: wrap(`
      <p>Здравствуйте, ${fn}!</p>
      <p>Пароль вашего аккаунта ИСПУМ был успешно изменён.</p>
      <p style="color:#6B6560;font-size:13px">
        Если это были не вы, немедленно свяжитесь с нами:
        <a href="mailto:support@ispum.ru" style="color:#C8860A">support@ispum.ru</a>
      </p>
    `),
    text:
      `Здравствуйте, ${fn}!\n\n` +
      `Пароль вашего аккаунта ИСПУМ изменён.\n\n` +
      `Если это были не вы, напишите нам: support@ispum.ru\n\nИСПУМ · ispum.ru`,
  }
}
