# API 서버 이미지.
# 태그 고정 + lockfile 기반 설치 + non-root 실행.
FROM node:22-alpine

WORKDIR /app

# lockfile 을 반드시 함께 복사한다. 이전에는 package.json 만 복사하고
# `npm install --production` 을 실행해 빌드마다 의존성 버전이 달라질 수 있었다
# (재현 불가능 빌드 + 공급망 위험).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 서버 소스 (index.js + lib/ + routes/ + openapi.yaml)
COPY index.js openapi.yaml ./
COPY lib ./lib
COPY routes ./routes

# /app 전체를 non-root 사용자 소유로 만든다.
# node 이미지에는 uid/gid 1000 인 `node` 사용자가 이미 있다.
#
# ⚠️ data 디렉토리만 chown 하면 안 된다. COPY 는 호스트 파일의 모드를 그대로 보존하는데,
#    이 저장소의 파일은 공유 디렉토리 ACL 때문에 660(그룹/타인 읽기 없음)이다.
#    그 상태로 USER node 로 전환하면 `EACCES: permission denied, open '/app/index.js'` 로
#    부팅조차 못 한다 (2026-08-05 재배포에서 실제 발생).
#
# ⚠️ 기존 api_data 볼륨의 파일은 root 소유다(non-root 전환 전에 생성됨).
#    start_server.sh 가 `up` 이전에 볼륨 소유권을 1000:1000 으로 맞춘다(멱등).
#    수동 실행: sudo docker run --rm -v projecthelper_api_data:/data alpine:3.20 chown -R 1000:1000 /data
RUN mkdir -p /app/data \
    && chown -R node:node /app \
    && chmod -R u+rX /app

# root 로 실행하지 않는다 — 컨테이너 탈출 시 피해 범위를 줄인다.
USER node

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "index.js"]
