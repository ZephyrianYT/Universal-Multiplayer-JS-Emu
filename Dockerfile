FROM node:22-alpine
LABEL org.opencontainers.image.title="retro-hub" org.opencontainers.image.version="1.26.3"
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY server.mjs ./
COPY core ./core
COPY public ./public
ENV PORT=8080 ROMS_DIR=/roms CORES_CACHE=/cache/cores NODE_ENV=production
RUN mkdir -p /cache/cores && chown -R node:node /cache
VOLUME ["/roms", "/cache"]
EXPOSE 8080
USER node
CMD ["node", "server.mjs"]
