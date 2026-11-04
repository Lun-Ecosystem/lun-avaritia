# The server and its front in one image (amd64 for the NAS). The server runs its TypeScript sources directly.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY app/package.json app/
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app /app
# The database lives in /app/data: a volume mounted there keeps it across images.
RUN mkdir -p data && chown node:node data
USER node
EXPOSE 8789
# The front answers as soon as the server listens.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8789)+'/').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--experimental-strip-types", "--no-warnings", "server/src/main.ts"]
