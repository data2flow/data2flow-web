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
# 실행에는 npm·corepack이 필요 없다. 이미지에 딸려 오는 npm의 의존성 취약점(Trivy)을 없애려고 지운다
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg
ENV NODE_ENV=production TZ=UTC PORT=8080
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/build ./build
USER node
EXPOSE 8080
CMD ["node_modules/.bin/react-router-serve", "./build/server/index.js"]
