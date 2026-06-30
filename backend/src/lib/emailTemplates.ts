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

// ─── Pro tier granted by an admin (free comp / pilot / institutional) ────────

export function proGrantedEmail(
  name: string,
  days: number,
  expiresAt: Date
): Omit<EmailPayload, 'to'> {
  const fn  = firstName(name)
  const url = `${process.env.FRONTEND_URL ?? ''}/dashboard`
  return {
    subject: 'Вам предоставлен бесплатный доступ к ИСПУМ Pro',
    html: wrap(`
      <p>Здравствуйте, ${fn}!</p>
      <p>Поздравляем — вам предоставлен <strong>бесплатный доступ к ИСПУМ Pro</strong> на ${days} ${pluralDays(days)}.</p>
      <p style="color:#6B6560;font-size:13px">
        Доступ активен до <strong>${fmtRu(expiresAt)}</strong>. По истечении срока аккаунт автоматически вернётся на бесплатный план — оплата не списывается.
      </p>
      <p>Что включает Pro:</p>
      <ul style="color:#1A1A1A;font-size:14px;line-height:1.7;padding-left:18px;margin:8px 0">
        <li>Безлимитные проверки работ и презентации</li>
        <li>Загрузка PDF / Word / изображений</li>
        <li>RAG-маховик — точность растёт с каждой проверкой</li>
        <li>Генерация писем со студенческой обратной связью</li>
        <li>Полная история проверок</li>
      </ul>
      ${btn(url, 'Перейти в ИСПУМ')}
      <p style="color:#6B6560;font-size:13px">
        Если у вас есть вопросы, напишите нам: <a href="mailto:support@ispum.ru" style="color:#C8860A">support@ispum.ru</a>.
      </p>
    `),
    text:
      `Здравствуйте, ${fn}!\n\n` +
      `Вам предоставлен бесплатный доступ к ИСПУМ Pro на ${days} ${pluralDays(days)}.\n` +
      `Доступ активен до ${fmtRu(expiresAt)}. По истечении срока аккаунт автоматически вернётся на бесплатный план.\n\n` +
      `Что включает Pro:\n` +
      `· Безлимитные проверки и презентации\n` +
      `· Загрузка PDF / Word / изображений\n` +
      `· RAG-маховик — точность растёт с каждой проверкой\n` +
      `· Генерация писем со студенческой обратной связью\n` +
      `· Полная история проверок\n\n` +
      `Перейти в ИСПУМ: ${url}\n\n` +
      `Вопросы: support@ispum.ru\n\nИСПУМ · ispum.ru`,
  }
}

// Russian plural for «дн.» — 1 день / 2 дня / 5 дней / 21 день / 22 дня / 25 дней.
function pluralDays(n: number): string {
  const mod10  = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'день'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'дня'
  return 'дней'
}

// ─── Password reset ───────────────────────────────────────────────────────────

export function passwordResetEmail(
  name: string,
  resetUrl: string
): Omit<EmailPayload, 'to'> {
  const fn = firstName(name)
  return {
    category: 'security',
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
    category: 'security',
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

// ─── Admin notifications (to the platform owner) ──────────────────────────────

export function adminSignupEmail(data: {
  name?: string | null; email: string; university?: string | null; viaInvite?: boolean
}): Omit<EmailPayload, 'to'> {
  const when = fmtRu(new Date())
  return {
    subject: `[ИСПУМ] Новая регистрация — ${data.email}`,
    html: wrap(`
      <p><strong>Новый преподаватель зарегистрировался в ИСПУМ.</strong></p>
      <p>
        Имя: ${data.name || '—'}<br>
        Эл. почта: ${data.email}<br>
        Организация: ${data.university || '—'}<br>
        ${data.viaInvite ? 'Источник: по приглашению организации<br>' : ''}
        Дата: ${when}
      </p>
    `),
    text:
      `Новая регистрация в ИСПУМ\n\n` +
      `Имя: ${data.name || '—'}\nEmail: ${data.email}\n` +
      `Организация: ${data.university || '—'}\n${data.viaInvite ? 'Источник: приглашение организации\n' : ''}` +
      `Дата: ${when}`,
  }
}

export function adminPurchaseEmail(data: {
  email: string; planLabel: string; amountRub: number; orderId: string
}): Omit<EmailPayload, 'to'> {
  const when = fmtRu(new Date())
  return {
    subject: `[ИСПУМ] Оплата — ${data.planLabel} (${data.email})`,
    html: wrap(`
      <p><strong>Поступила оплата в ИСПУМ.</strong></p>
      <p>
        Преподаватель: ${data.email}<br>
        Тариф: ${data.planLabel}<br>
        Сумма: ${data.amountRub.toLocaleString('ru-RU')} ₽<br>
        Заказ: ${data.orderId}<br>
        Дата: ${when}
      </p>
    `),
    text:
      `Поступила оплата в ИСПУМ\n\n` +
      `Преподаватель: ${data.email}\nТариф: ${data.planLabel}\n` +
      `Сумма: ${data.amountRub} ₽\nЗаказ: ${data.orderId}\nДата: ${when}`,
  }
}

export function feedbackEmail(data: {
  name?: string | null; email: string; plan: string; category: string; message: string; page?: string | null
}): Omit<EmailPayload, 'to'> {
  const labels: Record<string, string> = { bug: 'Проблема', idea: 'Идея', question: 'Вопрос', other: 'Другое' }
  const cat = labels[data.category] ?? data.category
  const safe = data.message.replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return {
    subject: `[ИСПУМ] Отзыв (${cat}) — ${data.email}`,
    html: wrap(`
      <p><strong>Новый отзыв в ИСПУМ.</strong></p>
      <p style="color:#6B6560;font-size:13px">
        От: ${data.name || '—'} (${data.email})<br>
        Тариф: ${data.plan}${data.page ? `<br>Страница: ${data.page}` : ''}<br>
        Категория: ${cat}
      </p>
      <div style="margin-top:12px;padding:14px 16px;background:#FAF8F4;border:1px solid rgba(0,0,0,0.08);border-radius:8px;white-space:pre-wrap">${safe}</div>
      <p style="margin-top:16px"><a href="mailto:${data.email}" style="color:#C8860A">Ответить ${data.email}</a></p>
    `),
    text:
      `Новый отзыв в ИСПУМ\n\n` +
      `От: ${data.name || '—'} (${data.email})\nТариф: ${data.plan}\n` +
      `${data.page ? `Страница: ${data.page}\n` : ''}Категория: ${cat}\n\n${data.message}`,
  }
}

// ─── Institution teacher invite ───────────────────────────────────────────────

export function teacherInviteEmail(
  inviterName:     string,
  institutionName: string,
  inviteUrl:       string
): Omit<EmailPayload, 'to'> {
  const inviter = firstName(inviterName)
  return {
    subject: `Приглашение в ИСПУМ — ${institutionName}`,
    html: wrap(`
      <p>Здравствуйте!</p>
      <p><strong>${inviter}</strong> приглашает вас присоединиться к ИСПУМ
         в рамках организации <strong>${institutionName}</strong>.</p>
      <p>ИСПУМ — платформа для преподавателей: проверка студенческих работ с ИИ
         и подготовка материалов к лекциям.</p>
      ${btn(inviteUrl, 'Принять приглашение')}
      <p style="color:#6B6560;font-size:13px">
        Приглашение действительно 7 дней. Если ссылка не открывается, скопируйте её в браузер:<br>
        <span style="color:#C8860A;word-break:break-all">${inviteUrl}</span>
      </p>
    `),
    text:
      `Здравствуйте!\n\n` +
      `${inviter} приглашает вас в ИСПУМ (${institutionName}).\n\n` +
      `Примите приглашение: ${inviteUrl}\n\n` +
      `Приглашение действительно 7 дней.\n\nИСПУМ · ispum.ru`,
  }
}
