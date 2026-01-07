# 리눅스 서버 배포 가이드 (Linux Deployment Guide)

이 문서는 Project Management 애플리케이션을 리눅스 서버 환경에서 실행하기 위한 가이드입니다.

## 1. 사전 준비 (Prerequisites)

서버에 다음 중 **하나**는 반드시 설치되어 있어야 합니다.

*   **옵션 A (추천): Docker & Docker Compose**
    *   환경에 구애받지 않고 가장 깔끔하게 실행할 수 있습니다.
*   **옵션 B: Node.js (v18 이상)**
    *   Docker 없이 직접 Node.js 환경에서 빌드하고 실행합니다.

## 2. 파일 구성

프로젝트 루트에 다음 파일들이 포함되어 있습니다:
*   `Dockerfile`: 도커 이미지 빌드 설정
*   `docker-compose.yml`: 도커 컨테이너 실행 설정
*   `start_server.sh`: 자동 배포 스크립트

## 3. 실행 방법 (How to Run)

### 방법 A: 자동 스크립트 사용 (가장 간편)

리눅스 터미널에서 프로젝트 폴더로 이동한 후, 아래 명령어를 실행하세요.

```bash
# 실행 권한 부여
chmod +x start_server.sh

# 스크립트 실행
./start_server.sh
```

이 스크립트는:
1.  Docker가 설치되어 있으면 Docker로 컨테이너를 띄웁니다.
2.  Docker가 없으면 Node.js를 사용하여 빌드 후 `serve`로 실행합니다.
3.  실행 후 `http://서버IP:8080`으로 접속할 수 있습니다.

---

### 방법 B: Docker 수동 실행

```bash
# 이미지 빌드 및 컨테이너 실행 (백그라운드)
docker-compose up -d --build

# 로그 확인
docker-compose logs -f

# 중지
docker-compose down
```

---

### 방법 C: Node.js 수동 실행

```bash
# 1. 의존성 설치
npm install

# 2. 프로젝트 빌드 (dist 폴더 생성)
npm run build

# 3. 정적 파일 서빙 도구 설치 (없을 경우)
npm install -g serve

# 4. 서버 실행 (포트 8080)
serve -s dist -l 8080
```

## 4. 접속 확인

브라우저를 열고 `http://<서버_IP_주소>:8080` 으로 접속하여 애플리케이션이 정상적으로 뜨는지 확인하세요.

## 5. 문제 해결 (Troubleshooting)

*   **권한 문제**: `permission denied` 에러가 발생하면 명령어 앞에 `sudo`를 붙여보세요 (예: `sudo ./start_server.sh`).
*   **포트 충돌**: 8080 포트가 이미 사용 중이라면 `docker-compose.yml` 또는 `start_server.sh`에서 포트 번호를 변경하세요.
