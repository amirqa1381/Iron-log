# Production Dockerfile for Iron Log (Node.js & TypeScript)
FROM node:22-alpine

WORKDIR /app

# Copy package files
COPY package*.json tsconfig.json ./

# Install dependencies
RUN npm ci --omit=dev || npm install --omit=dev

# Copy application files
COPY frontend ./frontend
COPY services ./services
COPY server.ts ./
COPY server.js ./

# Port 3000 is default
ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000

# Start unified server
CMD ["node", "server.js"]
