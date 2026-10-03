# data2flow-web 실행 이미지(SSR + BFF). 비루트(node, UID 1000), TZ=UTC, 포트 8080
FROM node:22-alpine AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build && pnpm prune --prod

FROM node:22-alpine
ENV NODE_ENV=production TZ=UTC PORT=8080
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/build ./build
USER node
EXPOSE 8080
CMD ["node_modules/.bin/react-router-serve", "./build/server/index.js"]
