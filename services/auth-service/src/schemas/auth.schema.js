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