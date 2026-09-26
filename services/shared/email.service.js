import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

// Determine email configuration
export function getEmailConfigStatus() {
  const isGmail = Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASS);
  const isCustomSmtp = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  const isConfigured = isGmail || isCustomSmtp;

  return {
    isConfigured,
    provider: isGmail ? 'google_gmail' : (isCustomSmtp ? 'custom_smtp' : 'mock_preview'),
    providerLabel: isGmail ? 'Google Gmail (App Password)' : (isCustomSmtp ? 'SMTP سفارشی' : 'حالت تستی / پیش‌نمایش کنسول (بدون نیاز به تنظیمات فوری)'),
    senderEmail: isGmail ? process.env.GMAIL_USER : (process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@ironlog.app'),
    instructions: [
      '۱. به حساب کاربری Google خود (myaccount.google.com) بروید.',
      '۲. وارد بخش امنیت (Security) شوید و ورود دو مرحله‌ای (2-Step Verification) را فعال کنید.',
      '۳. در انتهای بخش امنیت روی رمزهای برنامه (App Passwords) کلیک کنید.',
      '۴. یک رمز عبور ۱۶ رقمی برای "Mail" ایجاد کنید.',
      '۵. مقادیر GMAIL_USER و GMAIL_APP_PASS را در فایل .env یا متغیرهای محیطی قرار دهید.'
    ]
  };
}

function createTransporter() {
  const isGmail = Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASS);
  if (isGmail) {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASS
      }
    });
  }

  const isCustomSmtp = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  if (isCustomSmtp) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }

  return null;
}

/**
 * Sends a password reset email to the user.
 * If SMTP is not yet configured, gracefully logs to console and returns preview data so the user can test the reset flow immediately!
 */
export async function sendPasswordResetEmail({ to, code, resetUrl, displayName }) {
  const config = getEmailConfigStatus();
  const userName = displayName || to.split('@')[0];
  const fromAddress = config.senderEmail || 'IRON LOG <noreply@ironlog.app>';

  const htmlContent = `
  <!DOCTYPE html>
  <html lang="fa" dir="rtl">
  <head>
    <meta charset="utf-8">
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Vazirmatn', Tahoma, sans-serif; background-color: #1c1e1f; color: #edeae3; margin: 0; padding: 24px; direction: rtl; }
      .container { max-width: 520px; margin: 0 auto; background: #25282a; border-radius: 12px; border: 1px solid rgba(237,234,227,0.1); padding: 32px; box-shadow: 0 8px 24px rgba(0,0,0,0.4); }
      .brand { font-size: 22px; font-weight: 800; color: #edeae3; letter-spacing: 1px; margin-bottom: 20px; text-align: center; }
      .brand span { color: #d9a441; }
      .code-box { background: #1c1e1f; border: 2px dashed #d9a441; border-radius: 8px; padding: 18px; text-align: center; margin: 24px 0; }
      .code-digit { font-family: monospace; font-size: 32px; font-weight: 700; color: #d9a441; letter-spacing: 8px; }
      .btn { display: block; text-align: center; background: #d9a441; color: #1c1e1f; font-weight: 700; font-size: 15px; padding: 12px 24px; border-radius: 8px; text-decoration: none; margin: 24px 0; }
      .footer { font-size: 12px; color: #9aa0a6; line-height: 1.8; margin-top: 24px; border-top: 1px solid rgba(237,234,227,0.1); padding-top: 16px; text-align: center; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="brand">IRON <span>LOG</span></div>
      <h2 style="font-size: 18px; margin-top: 0; color: #edeae3;">درخواست بازیابی رمز عبور</h2>
      <p style="font-size: 14px; line-height: 1.8; color: #edeae3;">
        سلام <b>${userName}</b> عزیز،<br>
        درخواستی برای بازیابی و تغییر رمز عبور حساب کاربری شما در دفتر تمرین آهنین (Iron Log) دریافت شد.
      </p>

      <div class="code-box">
        <div style="font-size: 12px; color: #9aa0a6; margin-bottom: 6px;">کد تایید ۶ رقمی شما:</div>
        <div class="code-digit">${code}</div>
      </div>

      ${resetUrl ? `
      <div style="text-align: center;">
        <a href="${resetUrl}" class="btn" target="_blank">تغییر مستقیم رمز عبور</a>
      </div>
      ` : ''}

      <p style="font-size: 13px; line-height: 1.8; color: #9aa0a6;">
        ⏱️ این کد به مدت <b>۶۰ دقیقه</b> معتبر است.<br>
        اگر شما این درخواست را نداده‌اید، نیازی به انجام کاری نیست و رمز عبور قبلی شما محفوظ خواهد ماند.
      </p>

      <div class="footer">
        این ایمیل به صورت خودکار از طرف سیستم Iron Log ارسال شده است.<br>
        امنیت شما برای ما اهمیت دارد.
      </div>
    </div>
  </body>
  </html>
  `;

  const transporter = createTransporter();

  if (transporter) {
    try {
      const info = await transporter.sendMail({
        from: fromAddress,
        to,
        subject: `بازیابی رمز عبور حساب کاربری | کد تایید: ${code}`,
        text: `کد تایید بازیابی رمز عبور Iron Log شما: ${code}\nاین کد ۶۰ دقیقه معتبر است.`,
        html: htmlContent
      });
      console.log(`[Email Sent] Password reset sent to ${to}. MessageId: ${info.messageId}`);
      return {
        success: true,
        provider: config.provider,
        messageId: info.messageId,
        previewCode: null // Sent via real email
      };
    } catch (err) {
      console.error('[Email Send Error]', err.message);
      // Fallback to preview response so user is never blocked
      return {
        success: false,
        provider: config.provider,
        error: err.message,
        previewCode: code,
        resetUrl
      };
    }
  }

  // Mock / Preview Mode: log clearly to terminal
  console.log('====================================================');
  console.log('📩 [MOCK EMAIL SERVICE] Password Reset Email Simulation');
  console.log(`👉 گیرنده: ${to}`);
  console.log(`👉 کد تایید ۶ رقمی: ${code}`);
  if (resetUrl) console.log(`👉 لینک مستقیم ریست: ${resetUrl}`);
  console.log('ℹ️ برای اتصال به جیمیل، متغیرهای GMAIL_USER و GMAIL_APP_PASS را تنظیم کنید.');
  console.log('====================================================');

  return {
    success: true,
    provider: 'mock_preview',
    previewCode: code,
    resetUrl
  };
}

/**
 * Sends a test email to verify SMTP / Google Gmail connectivity
 */
export async function sendTestEmail({ to }) {
  const config = getEmailConfigStatus();
  const transporter = createTransporter();

  if (!transporter) {
    throw new Error('هیچ سرور ایمیلی تنظیم نشده است. لطفاً ابتدا GMAIL_USER و GMAIL_APP_PASS را در متغیرهای محیطی وارد کنید.');
  }

  const fromAddress = config.senderEmail;
  const info = await transporter.sendMail({
    from: fromAddress,
    to,
    subject: 'تست موفقیت‌آمیز اتصال سرویس ایمیل Iron Log',
    text: 'اتصال سرویس ایمیل شما به درستی برقرار شد و ارسال ایمیل‌ها فعال است.',
    html: `
      <div style="font-family:sans-serif;direction:rtl;padding:20px;background:#25282a;color:#edeae3;border-radius:8px;">
        <h2 style="color:#6fbf73;">✅ اتصال ایمیل با موفقیت تایید شد</h2>
        <p>این یک ایمیل تستی از دفتر تمرین آهنین (Iron Log) است.</p>
        <p style="color:#9aa0a6;">ارائه‌دهنده فعال: <b>${config.providerLabel}</b></p>
        <p style="color:#9aa0a6;">فرستنده: <b>${fromAddress}</b></p>
      </div>
    `
  });

  return {
    success: true,
    messageId: info.messageId,
    provider: config.provider
  };
}
