# Build from the repository root.
FROM node:22-bookworm-slim AS build
WORKDIR /app/games/muppet-games
COPY games/muppet-games/package*.json ./
RUN npm ci
COPY games/muppet-games/ ./
COPY games/shared/ /app/games/shared/
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 PUB_LEDGER=/data/ledger.json
WORKDIR /app/games/muppet-games
COPY --from=build --chown=node:node /app/games/muppet-games/package.json ./
COPY --from=build --chown=node:node /app/games/muppet-games/node_modules ./node_modules
COPY --from=build --chown=node:node /app/games/muppet-games/dist ./dist
COPY --from=build --chown=node:node /app/games/muppet-games/server ./server
COPY --from=build --chown=node:node /app/games/muppet-games/src/air-hockey ./src/air-hockey
COPY --from=build --chown=node:node /app/games/shared /app/games/shared
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
