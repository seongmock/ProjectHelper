FROM node:18-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --production

# 서버 전체 소스 (index.js + lib/ + routes/ + openapi.yaml)
COPY index.js openapi.yaml ./
COPY lib ./lib
COPY routes ./routes

RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "index.js"]
