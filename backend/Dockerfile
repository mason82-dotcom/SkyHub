FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
# Include all first-party modules required by server.js at runtime.
COPY backend/*.js ./
COPY frontend/public /app/frontend/public
EXPOSE 4000
USER node
CMD ["node", "server.js"]
