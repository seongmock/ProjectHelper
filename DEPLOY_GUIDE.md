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

### 방법 A: 자동 스크립트 사용 (추천)
 
 **1. 기본 실행 (HTTP - 권장)**
 가장 호환성이 좋으며, 원격 접속 시 오류가 없습니다.
 ```bash
 ./start_server.sh
 ```
 *   접속: `http://localhost:8080`
 *   참고: 클립보드 복사 기능은 "이미지 다운로드"로 자동 대체됩니다.
 
 **2. HTTPS 실행 (클립보드 기능 필요 시)**
 클립보드 API(복사하기)를 사용하려면 HTTPS가 필요합니다.
 ```bash
 ./start_https.sh
 ```
 *   접속: `https://localhost:8080` (보안 경고 무시 필요)
 *   IP 접속 시에도 HTTPS가 적용되나, 브라우저가 강력하게 경고할 수 있습니다.
 
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

## 6. 서비스 등록 (Service Registration) - 선택 사항

서버가 재부팅되어도 애플리케이션이 자동으로 실행되도록 하려면 `systemd` 서비스로 등록하세요.

1.  **서비스 파일 수정**:
    `project-management.service` 파일을 열어 `WorkingDirectory` 경로를 현재 프로젝트 경로로 수정하세요.
    ```ini
    WorkingDirectory=/home/user/project-management  <-- 실제 경로로 변경
    ```

2.  **파일 복사**:
    ```bash
    sudo cp project-management.service /etc/systemd/system/
    ```

3.  **서비스 활성화 및 시작**:
    ```bash
    # 서비스 데몬 리로드
    sudo systemctl daemon-reload
    
    # 부팅 시 자동 실행 활성화
    sudo systemctl enable project-management
    
    # 서비스 바로 시작
    sudo systemctl start project-management
    ```

4.  **상태 확인**:
    ```bash
sudo systemctl status project-management
    ```

## 7. HTTPS 설정 및 클립보드 기능 (Important)

이 애플리케이션의 **"이미지 캡처 후 클립보드 복사"** 기능은 브라우저 보안 정책상 **HTTPS** 환경(또는 localhost)에서만 작동합니다.

*   **기본 동작 (`start_server.sh`)**: HTTP로 실행되며, 클립보드 복사 시 자동으로 **파일 다운로드**가 수행됩니다.
*   **HTTPS 사용 (`start_https.sh`)**: HTTPS가 필요한 경우 이 스크립트를 사용하면 Caddy를 통해 즉시 HTTPS 환경이 구축됩니다.
*   **수동 설정 (Nginx)**: 만약 Caddy 대신 기존 Nginx 서버를 사용하시려면 아래 설정을 참고하세요.

### (예시) Nginx 리버스 프록시 설정
Nginx를 사용 중이라면 아래와 같이 프록시 설정을 추가할 수 있습니다.

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;
    
    # SSL 인증서 경로 설정...

    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```
