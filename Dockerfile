FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DB_FILE=/data/salah-phone.db \
    UPLOAD_DIR=/data/uploads
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY lib ./lib
COPY public ./public
COPY scripts ./scripts
COPY server.js ./
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:${PORT}/api/health || exit 1
CMD ["node", "--no-warnings=ExperimentalWarning", "server.js"]
