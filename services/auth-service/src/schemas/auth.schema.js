import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email({ message: 'ایمیل معتبر نیست' }),
  password: z.string().min(6, { message: 'رمز عبور باید حداقل ۶ کاراکتر باشد' }),
  displayName: z.string().min(2, { message: 'نام نمایشی باید حداقل ۲ کاراکتر باشد' }).optional()
});

export const loginSchema = z.object({
  email: z.string().email({ message: 'ایمیل معتبر نیست' }),
  password: z.string().min(1, { message: 'رمز عبور را وارد کنید' })
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, { message: 'رمز عبور فعلی را وارد کنید' }),
  newPassword: z.string().min(6, { message: 'رمز عبور جدید باید حداقل ۶ کاراکتر باشد' })
});

export const forgotPasswordSchema = z.object({
  email: z.string().email({ message: 'ایمیل معتبر نیست' })
});

export const resetPasswordSchema = z.object({
  email: z.string().email({ message: 'ایمیل معتبر نیست' }).optional(),
  code: z.string().optional(),
  token: z.string().optional(),
  newPassword: z.string().min(6, { message: 'رمز عبور جدید باید حداقل ۶ کاراکتر باشد' })
});
