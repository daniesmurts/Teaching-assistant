import type { EmailPayload } from '../services/emailTransport'
import { escapeHtml } from './escapeHtml'

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
      <p>Здравствуйте, ${escapeHtml(fn)}!</p>
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
      <p>Здравствуйте, ${escapeHtml(fn)}!</p>
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

export function registrationEmail(name: string, verifyUrl?: string): Omit<EmailPayload, 'to'> {
  const fn  = firstName(name)
  const url = `${process.env.FRONTEND_URL ?? ''}/dashboard`
  const verifyBlock = verifyUrl
    ? `<p>Пожалуйста, подтвердите свой адрес эл. почты — это нужно, чтобы вы
         могли восстановить доступ к аккаунту, если забудете пароль.</p>
       ${btn(verifyUrl, 'Подтвердить почту')}`
    : ''
  const verifyText = verifyUrl ? `Подтвердите почту: ${verifyUrl}\n\n` : ''
  return {
    subject: 'Добро пожаловать в ИСПУМ',
    html: wrap(`
      <p>Здравствуйте, ${escapeHtml(fn)}!</p>
      <p>Ваш аккаунт ИСПУМ создан. Вы готовы приступить к работе.</p>
      ${verifyBlock}
      ${btn(url, 'Перейти в ИСПУМ')}
      <p style="color:#6B6560;font-size:13px">
        Бесплатный план включает 20 проверок работ и 3 презентации в месяц.<br>
        Перейдите на Pro для неограниченного доступа.
      </p>
    `),
    text:
      `Здравствуйте, ${fn}!\n\nВаш аккаунт ИСПУМ создан.\n\n` +
      verifyText +
      `Перейти в ИСПУМ: ${url}\n\nИСПУМ · ispum.ru`,
  }
}

// ─── Email verification (re-send from the in-app banner) ─────────────────────

export function verifyEmailResendEmail(name: string, verifyUrl: string): Omit<EmailPayload, 'to'> {
  const fn = firstName(name)
  return {
    subject: 'Подтвердите адрес эл. почты — ИСПУМ',
    html: wrap(`
      <p>Здравствуйте, ${escapeHtml(fn)}!</p>
      <p>Нажмите кнопку ниже, чтобы подтвердить, что этот адрес принадлежит вам.
         Это нужно, чтобы вы могли восстановить доступ к аккаунту ИСПУМ,
         если забудете пароль.</p>
      ${btn(verifyUrl, 'Подтвердить почту')}
    `),
    text:
      `Здравствуйте, ${fn}!\n\nПодтвердите адрес эл. почты для аккаунта ИСПУМ:\n${verifyUrl}\n\nИСПУМ · ispum.ru`,
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
      <p>Здравствуйте, ${escapeHtml(fn)}!</p>
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
      <p>Здравствуйте, ${escapeHtml(fn)}!</p>
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
      <p>Здравствуйте, ${escapeHtml(fn)}!</p>
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
        Имя: ${escapeHtml(data.name || '—')}<br>
        Эл. почта: ${escapeHtml(data.email)}<br>
        Организация: ${escapeHtml(data.university || '—')}<br>
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
        Преподаватель: ${escapeHtml(data.email)}<br>
        Тариф: ${escapeHtml(data.planLabel)}<br>
        Сумма: ${data.amountRub.toLocaleString('ru-RU')} ₽<br>
        Заказ: ${escapeHtml(data.orderId)}<br>
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
  const safe = escapeHtml(data.message)
  return {
    subject: `[ИСПУМ] Отзыв (${cat}) — ${data.email}`,
    html: wrap(`
      <p><strong>Новый отзыв в ИСПУМ.</strong></p>
      <p style="color:#6B6560;font-size:13px">
        От: ${escapeHtml(data.name || '—')} (${escapeHtml(data.email)})<br>
        Тариф: ${escapeHtml(data.plan)}${data.page ? `<br>Страница: ${escapeHtml(data.page)}` : ''}<br>
        Категория: ${escapeHtml(cat)}
      </p>
      <div style="margin-top:12px;padding:14px 16px;background:#FAF8F4;border:1px solid rgba(0,0,0,0.08);border-radius:8px;white-space:pre-wrap">${safe}</div>
      <p style="margin-top:16px"><a href="mailto:${escapeHtml(data.email)}" style="color:#C8860A">Ответить ${escapeHtml(data.email)}</a></p>
    `),
    text:
      `Новый отзыв в ИСПУМ\n\n` +
      `От: ${data.name || '—'} (${data.email})\nТариф: ${data.plan}\n` +
      `${data.page ? `Страница: ${data.page}\n` : ''}Категория: ${cat}\n\n${data.message}`,
  }
}

export function contactMessageEmail(data: {
  name: string; email: string; organization?: string | null; topic: string; message: string; sourcePage: string
}): Omit<EmailPayload, 'to'> {
  const labels: Record<string, string> = {
    support: 'Вопрос в поддержку', demo: 'Демо / Для ВУЗов', research: 'Исследовательское партнёрство', billing: 'Оплата',
  }
  const topicLabel = labels[data.topic] ?? data.topic
  const safe = escapeHtml(data.message)
  return {
    subject: `[ИСПУМ] ${topicLabel} — ${data.name}`,
    html: wrap(`
      <p><strong>Новое обращение с сайта ИСПУМ (${data.sourcePage === 'research' ? '/research' : '/contact'}).</strong></p>
      <p style="color:#6B6560;font-size:13px">
        От: ${escapeHtml(data.name)} (${escapeHtml(data.email)})${data.organization ? `<br>Организация: ${escapeHtml(data.organization)}` : ''}<br>
        Тема: ${escapeHtml(topicLabel)}
      </p>
      <div style="margin-top:12px;padding:14px 16px;background:#FAF8F4;border:1px solid rgba(0,0,0,0.08);border-radius:8px;white-space:pre-wrap">${safe}</div>
      <p style="margin-top:16px"><a href="mailto:${escapeHtml(data.email)}" style="color:#C8860A">Ответить ${escapeHtml(data.email)}</a></p>
    `),
    text:
      `Новое обращение с сайта ИСПУМ (${data.sourcePage === 'research' ? '/research' : '/contact'})\n\n` +
      `От: ${data.name} (${data.email})\n${data.organization ? `Организация: ${data.organization}\n` : ''}Тема: ${topicLabel}\n\n${data.message}`,
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
      <p><strong>${escapeHtml(inviter)}</strong> приглашает вас присоединиться к ИСПУМ
         в рамках организации <strong>${escapeHtml(institutionName)}</strong>.</p>
      <p>ИСПУМ — платформа для преподавателей: проверка студенческих работ с ИИ
         и подготовка материалов к лекциям.</p>
      ${btn(inviteUrl, 'Принять приглашение')}
      <p style="color:#6B6560;font-size:13px">
        Приглашение действительно 7 дней. Если ссылка не открывается, скопируйте её в браузер:<br>
        <span style="color:#C8860A;word-break:break-all">${escapeHtml(inviteUrl)}</span>
      </p>
    `),
    text:
      `Здравствуйте!\n\n` +
      `${inviter} приглашает вас в ИСПУМ (${institutionName}).\n\n` +
      `Примите приглашение: ${inviteUrl}\n\n` +
      `Приглашение действительно 7 дней.\n\nИСПУМ · ispum.ru`,
  }
}

// ─── Activation nudges ────────────────────────────────────────────────────────
// Lifecycle emails from the activation sweep (services/activation.ts). Each
// carries a working unsubscribe link (nudgeUnsubUrl → flips
// teachers.nudge_emails_enabled) — the sweep checks that flag before sending.

function nudgeFooter(unsubUrl: string): string {
  return `<p style="color:#A09890;font-size:12px;margin-top:24px">
    Не хотите получать подсказки по началу работы?
    <a href="${unsubUrl}" style="color:#A09890">Отписаться</a>
  </p>`
}

export function activation24hEmail(name: string, unsubUrl: string): Omit<EmailPayload, 'to'> {
  const fn  = firstName(name)
  const url = `${process.env.FRONTEND_URL ?? ''}/grading`
  return {
    subject: 'Проверьте первую работу за 2 минуты',
    html: wrap(`
      <p>Здравствуйте, ${escapeHtml(fn)}!</p>
      <p>Вы зарегистрировались в ИСПУМ, но ещё не проверили ни одной работы —
         а это самый быстрый способ понять, чем платформа полезна именно вам.</p>
      <p>Это занимает пару минут: вставьте текст любой студенческой работы
         (или загрузите файл) — ИСПУМ оценит её по критериям и подготовит
         подробный разбор, который вы сможете отредактировать и отправить студенту.</p>
      ${btn(url, 'Проверить работу')}
      <p style="color:#6B6560;font-size:13px">
        Нет под рукой студенческой работы? Возьмите любой реферат или эссе —
        для знакомства с проверкой подойдёт любой текст.
      </p>
      ${nudgeFooter(unsubUrl)}
    `),
    text:
      `Здравствуйте, ${fn}!\n\n` +
      `Вы зарегистрировались в ИСПУМ, но ещё не проверили ни одной работы. ` +
      `Это занимает пару минут: вставьте текст студенческой работы — ИСПУМ оценит её и подготовит разбор.\n\n` +
      `Проверить работу: ${url}\n\n` +
      `Отписаться от подсказок: ${unsubUrl}\n\nИСПУМ · ispum.ru`,
  }
}

export function activation72hEmail(name: string, unsubUrl: string): Omit<EmailPayload, 'to'> {
  const fn       = firstName(name)
  const videoUrl = `${process.env.FRONTEND_URL ?? ''}/help?video=first-steps`
  return {
    subject: '⏳ Сделайте первый шаг в ИСПУМ за 3 минуты',
    html: wrap(`
      <p>Здравствуйте, ${escapeHtml(fn)}!</p>
      <p>Вы уже зарегистрировались, но пока не начали проверять работы — и это совершенно нормально. 
Часто первый шаг (создать предмет и загрузить первую работу) кажется самым сложным.</p>

<p>На самом деле, чтобы получить <strong>первый готовый разбор для студента</strong>, вам нужно всего <strong>3 минуты</strong>. 
Мы записали короткое видео без лишней воды, где по шагам показываем:</p>
      
      ul>
  <li>Как создать предмет и добавить работу буквально за пару кликов;</li>
  <li>Как ИСПУМ автоматически анализирует текст;</li>
  <li>Как мгновенно посмотреть готовый результат с оценкой и комментариями.</li>
</ul>

<p>Посмотрите видео и сразу попробуйте применить на практике — вы увидите, как быстро проверка перестаёт быть рутиной.</p>
${btn(videoUrl, 'Смотреть видео и попробовать')}
      ${nudgeFooter(unsubUrl)}
    `),
    text:
      `Здравствуйте, ${fn}!\n\n` +
      `Мы записали короткое видео о первых шагах в ИСПУМ: как создать предмет, проверить работу и получить готовый разбор.\n\n` +
      `Смотреть: ${videoUrl}\n\n` +
      `Вопросы? Просто ответьте на это письмо.\n\n` +
      `Отписаться от подсказок: ${unsubUrl}\n\nИСПУМ · ispum.ru`,
  }
}
