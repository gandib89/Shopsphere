FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .
# Prisma's generated client (backend/generated/prisma) is gitignored — regenerate it
# from schema.prisma at build time instead of relying on a checked-in copy.
RUN npx prisma generate --schema=prisma/schema.prisma

RUN mkdir -p uploads && chown -R node:node uploads
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4000/health', r => process.exit(r.statusCode===200?0:1)).on('error', () => process.exit(1))"

USER node
# Applies committed migrations before every start — fine for this project's scale;
# a separate migration step/job is the usual upgrade path once deploys need to be decoupled.
CMD ["sh", "-c", "npx prisma migrate deploy --schema=prisma/schema.prisma && node scripts/provisionAssistantRole.js && node server.js"]
