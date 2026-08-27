FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .
# Prisma's generated client (backend/generated/prisma) is gitignored — regenerate it
# from schema.prisma at build time instead of relying on a checked-in copy.
RUN npx prisma generate --schema=prisma/schema.prisma

RUN mkdir -p uploads && chown -R node:node uploads
EXPOSE 4000

USER node
# Applies committed migrations before every start — fine for this project's scale;
# a separate migration step/job is the usual upgrade path once deploys need to be decoupled.
CMD ["sh", "-c", "npx prisma migrate deploy --schema=prisma/schema.prisma && node server.js"]
