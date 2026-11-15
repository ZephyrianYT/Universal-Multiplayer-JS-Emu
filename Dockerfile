FROM node:22-alpine
LABEL org.opencontainers.image.title="retro-hub" org.opencontainers.image.version="0.1.9.0"
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY server.mjs ./
COPY public ./public
ENV PORT=8080 ROMS_DIR=/roms CORES_CACHE=/cache/cores NODE_ENV=production
RUN mkdir -p /cache/cores && chown -R node:node /cache
VOLUME ["/roms", "/cache"]
EXPOSE 8080
USER node
CMD ["node", "server.mjs"]
