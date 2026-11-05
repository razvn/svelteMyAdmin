# svelteMyAdmin container image. Build: docker build -t sveltemyadmin .
# Run: mount a config.json at /config/config.json (see config.sample.json and docs/SIGNON.md).

FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@12.0.0 --activate
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm prune --prod --ignore-scripts

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production \
	HOST=0.0.0.0 \
	PORT=3000 \
	SMA_CONFIG=/config/config.json
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
# Numeric (the image's `node` user), so Kubernetes can enforce runAsNonRoot.
USER 1000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "build"]
