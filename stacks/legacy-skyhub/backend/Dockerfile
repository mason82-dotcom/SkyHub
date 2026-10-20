# syntax=docker/dockerfile:1
FROM node:22-alpine AS frontend-build
WORKDIR /frontend
COPY frontend/package.json ./
COPY frontend/public ./public
COPY frontend/scripts ./scripts
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app

COPY backend/package.json ./
RUN npm install --omit=dev --ignore-scripts
COPY backend ./
COPY --from=frontend-build /frontend/dist ./public

RUN chown -R node:node /app
USER node
EXPOSE 4000

CMD ["node", "server.js"]
