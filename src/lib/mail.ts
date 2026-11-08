import type { Env } from '../env';

/**
 * 邮件发送：Cloudflare Email Sending（Workers send_email binding）
 *
 * 需要的配置：
 *   EMAIL            必填，wrangler.toml 的 [[send_email]] binding
 *   MAIL_FROM        必填，发件地址，如 noreply@cloudcom.us.ci（secret）
 *   MAIL_FROM_NAME   可选，发件人显示名（默认 Nexus）
 *   MAIL_REPLY_TO    可选，回复地址
 *   SITE_URL         可选，邮件里的链接前缀（默认取请求 origin）
 *
 * 未配置时 mailConfigured() 返回 false，注册流程会跳过发信并只在日志里打印链接。
 */

export interface MailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

export interface MailResult {
  ok: boolean;
  id?: string;
  error?: string;
  status?: number;
}

export function mailConfigured(env: Env): boolean {
  return !!env.EMAIL && !!(env.MAIL_FROM || '').trim();
}

export async function sendMail(env: Env, opts: MailOptions): Promise<MailResult> {
  const from = (env.MAIL_FROM || '').trim();
  if (!env.EMAIL || !from) return { ok: false, error: 'mail_not_configured' };

  const name = (env.MAIL_FROM_NAME || env.SITE_NAME || 'Nexus').trim() || 'Nexus';
  const replyTo = (opts.replyTo || env.MAIL_REPLY_TO || '').trim();

  try {
    const result = await env.EMAIL.send({
      to: opts.to,
      from: { email: from, name },
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      ...(replyTo ? { replyTo } : {}),
    });
    return { ok: true, id: result.messageId };
  } catch (err) {
    const code = emailErrorCode(err);
    console.error('email_send_error', code ?? 'unknown', err instanceof Error ? err.message : err);
    if (code === 'E_RATE_LIMIT_EXCEEDED' || code === 'E_DAILY_LIMIT_EXCEEDED') {
      return { ok: false, error: 'rate_limited', status: 429 };
    }
    return { ok: false, error: 'send_failed' };
  }
}

/** Cloudflare Email Sending 抛出的 Error 带有字符串 code */
function emailErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object' || !('code' in err)) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && code ? code : undefined;
}

/** 验证邮件（中英双语，跟着用户语言走） */
export function verificationMail(input: {
  siteName: string;
  url: string;
  email: string;
  locale: 'zh-CN' | 'en-US';
}): { subject: string; html: string; text: string } {
  const { siteName, url, email, locale } = input;
  const zh = locale !== 'en-US';
  const subject = zh ? `验证你的邮箱 · ${siteName}` : `Verify your email · ${siteName}`;

  const title = zh ? '验证你的邮箱地址' : 'Verify your email address';
  const intro = zh
    ? `感谢注册 <strong>${escape(siteName)}</strong>。点击下面的按钮完成邮箱验证，链接 24 小时内有效。`
    : `Thanks for signing up for <strong>${escape(siteName)}</strong>. Click the button below to verify your email. The link expires in 24 hours.`;
  const button = zh ? '验证邮箱' : 'Verify email';
  const fallback = zh ? '按钮打不开？复制这个链接到浏览器：' : 'Button not working? Copy this link into your browser:';
  const ignore = zh
    ? '如果这不是你的操作，请忽略这封邮件，你的账号不会被激活。'
    : 'If you did not create this account, you can safely ignore this email.';
  const expiry = zh ? '此邮件由系统自动发送，请勿直接回复。' : 'This message was sent automatically. Please do not reply.';

  const html = `<!doctype html>
<html lang="${zh ? 'zh-CN' : 'en'}">
<body style="margin:0;padding:0;background:#f4f6f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;border:1px solid #e4e8ef;overflow:hidden;">
        <tr><td style="padding:28px 28px 8px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#8a94a3;">${escape(siteName)}</td></tr>
        <tr><td style="padding:0 28px;">
          <h1 style="margin:8px 0 12px;font-size:22px;line-height:1.3;color:#0f1319;">${title}</h1>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#57606e;">${intro}</p>
          <p style="margin:0 0 24px;">
            <a href="${escapeAttr(url)}" style="display:inline-block;padding:12px 22px;border-radius:10px;background:#4f46e5;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">${button}</a>
          </p>
          <p style="margin:0 0 8px;font-size:12.5px;color:#8a94a3;">${fallback}</p>
          <p style="margin:0 0 24px;font-size:12.5px;line-height:1.6;word-break:break-all;color:#57606e;">${escape(url)}</p>
          <p style="margin:0 0 8px;font-size:13px;line-height:1.7;color:#8a94a3;">${ignore}</p>
        </td></tr>
        <tr><td style="padding:16px 28px 24px;border-top:1px solid #eef1f6;font-size:12px;color:#8a94a3;">${expiry}<br />${escape(email)}</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    title,
    '',
    zh ? `感谢注册 ${siteName}，点击下面的链接完成邮箱验证（24 小时内有效）：` : `Thanks for signing up for ${siteName}. Verify your email (valid for 24 hours):`,
    url,
    '',
    ignore,
    expiry,
  ].join('\n');

  return { subject, html, text };
}

function escape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(value: string): string {
  return escape(value).replace(/'/g, '&#39;');
}
