# VRCX-0 자체 호스팅 기록기 (실험적)

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-Hant.md) | [日本語](README.ja-JP.md) | **한국어**

자체 호스팅 기록기는 항상 켜져 있는 기기에서 실행되며, VRCX-0이 꺼져 있는 동안 친구 활동을 기록합니다. VRCX-0을 시작하면 그동안의 기록이 로컬 피드에 채워집니다.

> [!WARNING]
> 실험적인 기능입니다. 기록기는 사용자 계정으로 다른 IP에서 VRChat에 로그인합니다. VRChat 정책과 보안 검사에 따라 연결 끊김이나 반복 인증이 발생할 수 있으며, 최악의 경우 계정 제한이나 정지가 될 수 있습니다. 사용에 따른 책임은 사용자에게 있습니다. 로그인 정보는 사용자의 기록기로만 전송됩니다.

## 범위

- 채우는 기록: 친구의 온라인·오프라인, 위치, 상태, 아바타 변경. VRCX-0에서 '친구 자기소개 자동 업데이트'를 켜면 자기소개 변경도 채웁니다.
- 기록기 하나는 VRChat 계정 하나만 다룹니다.
- 채우지 않는 기록:
    - VRCX-0이 충돌·강제 종료·절전·연결 끊김을 겪은 뒤 약 30초;
    - 기록 구간이 끝날 때 아직 확정되지 않은 오프라인;
    - 기록기 자체가 VRChat과 연결이 끊긴 동안의 변화.

## 요구 사항

- 항상 켜져 있는 기기. NAS, VPS, Raspberry Pi 등의 Linux(x86_64 또는 ARM64) 또는 Windows PC(x86_64).
- Docker와 Docker Compose v2(`docker compose` 명령). 단독 실행 파일도 제공합니다.
- VRCX-0에서 네트워크로 접속할 수 있어야 합니다.

## 설치

### 설치 스크립트

```sh
curl -fsSL https://raw.githubusercontent.com/Map1en/VRCX-0/master/crates/logger/install.sh | sh
```

설치 디렉터리, 릴리스 채널, 포트, 수신 주소, 보관 기간, 용량 한도, 비밀번호를 차례로 묻습니다. Enter를 누르면 대괄호 안의 기본값을 사용합니다. 이후 컨테이너를 시작하고 VRCX-0에 입력할 주소와 비밀번호를 보여 줍니다. 설정은 설치 디렉터리의 `.env`, 비밀번호는 `password`에 저장됩니다.

- 업데이트: 스크립트를 다시 실행합니다. 릴리스 채널만 묻고(기본값은 현재 채널) `.env`, `password`, `compose.yaml`은 그대로 둡니다. 다른 설정을 바꾸려면 `.env`를 편집한 뒤 설치 디렉터리에서 `docker compose up -d`를 실행합니다.
- 중지: `-s down`을 붙입니다(`... | sh -s down`).
- 현재 사용자가 Docker를 사용할 수 없으면 `sudo sh`를 사용합니다.

### Docker Compose

```sh
mkdir vrcx-0-logger && cd vrcx-0-logger
curl -fsSLO https://raw.githubusercontent.com/Map1en/VRCX-0/master/crates/logger/compose.yaml
printf '%s' '비밀번호' > password
docker compose up -d
```

NAS 관리 화면(Synology Container Manager, Unraid 등): 이미지에 `ghcr.io/map1en/vrcx-0-logger:latest`를 지정하고, 포트 `8787`과 폴더 하나를 `/data`에 연결한 뒤 환경 변수 `VRCX0_LOGGER_PASSWORD`를 설정합니다. Unraid에서는 `/data`를 캐시나 단일 디스크 경로(예: `/mnt/cache/appdata/vrcx-0-logger`)에 연결하세요. `/mnt/user` 공유에서는 SQLite가 손상될 수 있습니다. 비밀번호를 Compose 파일의 `environment:`에 직접 적는 경우 `$`를 `$$`로 적습니다.

### 릴리스 채널

| 태그     | 대상                           |
| -------- | ------------------------------ |
| `latest` | 정식 버전 VRCX-0               |
| `beta`   | 베타 버전 VRCX-0               |
| `x.y.z`  | 고정 버전(예: `2.32.0-beta.1`) |

정식 버전 VRCX-0은 정식 버전 기록기에만 연결합니다.

### 단독 실행 파일

[Releases](https://github.com/Map1en/VRCX-0/releases)에서 `vrcx-0-logger_<버전>_linux_<아키텍처>`를 내려받아 비밀번호 환경 변수를 설정하고 실행합니다. 계속 실행하려면 systemd 같은 서비스 관리자를 사용하세요.

### Windows

[Releases](https://github.com/Map1en/VRCX-0/releases)에서 `vrcx-0-logger_<버전>_windows_x86_64.exe`를 내려받아 실행합니다. 창에 VRCX-0에 입력할 주소와 자동으로 만들어진 비밀번호가 표시되며, 수신 주소, 포트, 데이터 폴더, 보관 기간, 저장 용량 한도도 여기서 바꿀 수 있습니다. 설정은 `%LOCALAPPDATA%\VRCX-0 Logger\logger.env`에 저장되고, 기록은 기본적으로 같은 위치의 `data` 폴더에 쌓입니다. 창이 열려 있는 동안 기록기가 동작하며, VRChat에 연결할 수 없는 등의 연결 문제는 상태 아래에 표시됩니다.

창 없이 실행하려면(작업 스케줄러에서 시작하는 경우 등) `--headless`를 붙여 실행하고 「설정 항목」의 환경 변수를 설정하세요.

### 설정 항목

설치 스크립트나 Docker Compose로 설치했다면 설치 디렉터리의 `.env`를 편집한 뒤 `docker compose up -d`를 실행합니다. 비밀번호는 `password` 파일에 있습니다.

| `.env` 키                     | 기본값    | 설명                                                           |
| ----------------------------- | --------- | -------------------------------------------------------------- |
| `VRCX0_LOGGER_TAG`            | `latest`  | 릴리스 채널.                                                   |
| `VRCX0_LOGGER_PORT`           | `8787`    | 호스트 포트.                                                   |
| `VRCX0_LOGGER_BIND`           | `0.0.0.0` | 호스트 수신 주소.                                              |
| `VRCX0_LOGGER_RETENTION_DAYS` | 무제한    | 이 일수보다 오래된 기록을 삭제합니다.                          |
| `VRCX0_LOGGER_MAX_STORAGE_MB` | `1024`    | 이 용량(MB)을 넘으면 오래된 기록부터 삭제합니다. `0`은 무제한. |

단독 실행 파일은 다음 환경 변수를 읽습니다. NAS 관리 화면에서는 컨테이너에 설정합니다.

| 변수                          | 기본값                        | 설명                                                           |
| ----------------------------- | ----------------------------- | -------------------------------------------------------------- |
| `VRCX0_LOGGER_PASSWORD`       | 필수                          | 8자 이상. 통신과 데이터 암호화에 사용.                         |
| `VRCX0_LOGGER_PASSWORD_FILE`  |                               | 비밀번호를 파일에서 읽습니다.                                  |
| `VRCX0_LOGGER_HOST`           | `0.0.0.0`                     | 수신 주소.                                                     |
| `VRCX0_LOGGER_PORT`           | `8787`                        | 수신 포트.                                                     |
| `VRCX0_LOGGER_DATA_DIR`       | `data` (Docker에서는 `/data`) | 데이터 디렉터리.                                               |
| `VRCX0_LOGGER_RETENTION_DAYS` | 무제한                        | 이 일수보다 오래된 기록을 삭제합니다.                          |
| `VRCX0_LOGGER_MAX_STORAGE_MB` | `1024`                        | 이 용량(MB)을 넘으면 오래된 기록부터 삭제합니다. `0`은 무제한. |

컨테이너에서는 `VRCX0_LOGGER_HOST`, `VRCX0_LOGGER_PORT`, `VRCX0_LOGGER_DATA_DIR`를 설정하지 말고, 포트를 바꿀 때는 포트 매핑을 변경하세요.

## VRCX-0에서 연결

**도구 → 자체 호스팅 기록기**:

1. 자동 백업을 켭니다.
2. 기록기 주소를 입력합니다(예: `http://192.168.1.10:8787`).
3. 기록기 비밀번호를 입력합니다.
4. 기록기를 VRChat에 로그인시키고, 필요하면 2단계 인증을 진행합니다.

VRCX-0과 기록기 사이의 통신은 비밀번호로 암호화됩니다. 포트를 인터넷에 공개하지 마세요. 외부에서 사용할 때는 Tailscale 같은 VPN을 사용하세요. VPS에서는 수신 주소(`.env`의 `VRCX0_LOGGER_BIND`)를 VPN 주소로 정하거나 방화벽으로 포트를 제한하세요.

## 사용

- **상태 표시줄**: 프록시 아이콘 옆 아이콘이 기록기 상태를 보여 줍니다. 주황색: 로그인 중, 다시 연결 중, 다른 계정, 응답 이상. 빨간색: 연결 불가, 비밀번호 오류, 버전 불일치, VRChat 재로그인 또는 2단계 인증 코드 필요.
- **채우기**: VRCX-0이 연결되면 자동으로 진행되며, '지금 채우기'로 직접 실행할 수도 있습니다. VRCX-0을 정상 종료하면 즉시 기록기로 넘어갑니다.
- **Webhook**: Discord 또는 POST를 받는 URL. 로그인 중지, 2단계 인증 필요, 기록 저장 실패, 채우지 않은 기록이 용량 한도로 삭제됨, 기록 재개 시 전송합니다. 각 메시지 앞에 유형(`login`, `storage`, `recovered`, `test`)을 표시하고, 오류가 있으면 원래 오류 내용을 붙입니다.
- **상태 확인**: `GET /health`는 기록기가 데이터베이스를 읽을 수 있으면 200을 반환합니다. 이미지에 셸이 없으므로 컨테이너 밖에서 모니터링하세요.

## 업데이트

설치 스크립트를 다시 실행하거나 `docker compose pull && docker compose up -d`를 실행합니다. 버전이 꼭 같을 필요는 없습니다. VRCX-0이 기록기 업데이트를 요구할 때 업데이트하세요. 그때까지 채우기는 멈추지만 기록은 유지됩니다.

## 문제 해결

| 문제               | 확인 사항                                                                                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 기록기에 연결 불가 | 컨테이너 실행 여부, 방화벽 포트 허용, 주소. macOS에서는 **로컬 네트워크**에서 VRCX-0을 허용합니다.                                                 |
| 비밀번호 오류      | VRCX-0의 비밀번호가 기록기 비밀번호와 같아야 합니다.                                                                                               |
| 다른 계정          | VRCX-0에서 쓰는 계정으로 기록기에 다시 로그인합니다.                                                                                               |
| 정식/베타 불일치   | 정식 버전 VRCX-0은 `latest`, 베타 버전은 `beta`를 사용합니다.                                                                                      |
| 로그               | 설치 디렉터리에서 `docker compose logs`를 실행합니다. Windows에서는 기록기 창에 오류가 표시되고, `--headless`로 실행하면 콘솔에 로그가 출력됩니다. |

## 데이터와 보안

- 기록과 VRChat 로그인 정보는 데이터 디렉터리에 비밀번호로 암호화되어 저장됩니다.
- '기록기에 비밀번호 저장'을 켜면 세션이 만료되었을 때 기록기가 스스로 다시 로그인합니다. 끄면 로그인 토큰만 저장합니다.
- 비밀번호를 바꾸면 채우지 않은 기록, VRChat 로그인, Webhook이 삭제됩니다. 먼저 VRCX-0에서 한 번 채운 뒤 `password` 파일을 바꾸고 `docker compose up -d --force-recreate`를 실행하세요. 그런 다음 VRCX-0에서 새 비밀번호로 다시 연결하고 기록기를 VRChat에 다시 로그인시키세요.
- VRCX-0이 가져간 기록은 기록기에서 삭제됩니다.

## 제거

VRCX-0에서 '연결 해제'를 선택하면 먼저 채운 뒤 기록기를 VRChat에서 로그아웃시키고 기록기 설정을 지웁니다. 그런 다음 `docker compose down`을 실행하고 설치 디렉터리를 삭제하세요.

## 라이선스

서드파티 라이선스 고지는 각 릴리스에 첨부되며 이미지의 `/usr/share/licenses/vrcx-0-logger/`에도 포함됩니다. 이미지를 직접 빌드하려면 릴리스 실행 파일을 `crates/logger/dist/vrcx-0-logger-amd64`와 `crates/logger/dist/vrcx-0-logger-arm64`에 두고, `LICENSE`와 릴리스의 `THIRD_PARTY_NOTICES.txt`를 `crates/logger/dist/`에 복사한 뒤 `docker build crates/logger`를 실행합니다.
