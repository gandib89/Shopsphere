FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

EXPOSE 4100

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:4100/health', r => process.exit(r.statusCode===200?0:1)).on('error', () => process.exit(1))"

USER node
CMD ["node", "src/server.js"]
