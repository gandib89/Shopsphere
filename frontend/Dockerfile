FROM node:20-alpine AS build
WORKDIR /app
ARG VITE_GOOGLE_CLIENT_ID=
ARG VITE_DEMO_MODE=true
# Container deployments always use the same-origin nginx API proxy.
ENV VITE_BACKEND_URL=""
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
ENV VITE_DEMO_MODE=$VITE_DEMO_MODE
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# HashRouter means every client route is a URL fragment (#/...), so the server only
# ever needs to serve the static files at their real paths — no SPA rewrite rules needed.
FROM nginx:alpine
ENV BACKEND_ORIGIN=http://backend:4000
ENV NGINX_ENVSUBST_FILTER=BACKEND_ORIGIN
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/templates/default.conf.template
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/ || exit 1
