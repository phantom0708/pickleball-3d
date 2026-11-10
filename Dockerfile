# Pickle Pop – server game (HTTP + WebSocket)
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app

COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev && npm cache clean --force

COPY index.html style.css ./
COPY js ./js
COPY shared ./shared
COPY vendor ./vendor
COPY server/*.js ./server/

RUN mkdir -p /app/server/data && chown -R node:node /app/server/data
USER node

ENV PORT=8080 HOST=0.0.0.0
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
CMD ["node", "server/index.js"]
