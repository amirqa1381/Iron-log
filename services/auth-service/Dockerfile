# استفاده از نسخه سبک و امن نود
FROM node:20-alpine

WORKDIR /app

# نصب پکیج‌ها
COPY package*.json ./
RUN npm install --production

# کپی کردن سورس کد
COPY . .

EXPOSE 4001

CMD ["node", "src/server.js"]