# 프론트엔드 이미지 — 빌드 후 nginx로 정적 서빙.
#
# 태그는 고정한다. 부동 태그(node:18-alpine 등)는 무관한 시점에 빌드가 깨지고,
# Node 18은 2025-04 지원 종료(EOL)라 보안 패치를 받지 못한다.

# ── Build Stage ──────────────────────────────────────
FROM node:22-alpine AS build

WORKDIR /app

# lockfile 을 함께 복사하고 `npm ci` 를 쓴다 — `npm install` 은 매 빌드마다
# 의존성 버전이 달라질 수 있어 재현 가능한 빌드가 되지 않는다.
COPY package.json package-lock.json ./
RUN npm ci

COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src
RUN npm run build

# ── Development Stage (hot-reload; docker-compose.dev.yml 에서 사용) ──
FROM node:22-alpine AS development

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
EXPOSE 80
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "80"]

# ── Production Stage ─────────────────────────────────
FROM nginx:1.29-alpine

# gzip + Cache-Control 설정 (nginx 기본 설정에는 둘 다 없다)
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
