FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# HashRouter means every client route is a URL fragment (#/...), so the server only
# ever needs to serve the static files at their real paths — no SPA rewrite rules needed.
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
