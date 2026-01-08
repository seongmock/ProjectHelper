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

*   **HTTP 접속 시**: 클립보드 복사가 차단되며, 자동으로 **이미지 파일 다운로드**로 전환됩니다.
*   **완벽한 기능 사용**: HTTPS를 적용하려면 Nginx 리버스 프록시와 Let's Encrypt 등을 사용하여 SSL 인증서를 설정해야 합니다.

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
