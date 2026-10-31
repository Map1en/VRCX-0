<div align="center">

# <img src="images/VRCX-0.png" alt="VRCX-0 Logo" width="25"> VRCX-0

### 더 빠르고, 더 가벼운 VRCX.

[English](README.md) | [Français](README.fr-FR.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-Hant.md) | [日本語](README.ja-JP.md) | 한국어

[![Release](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/Map1en/VRCX-0/badge-data/version.json&style=flat&color=4c566a&labelColor=1f2328&logo=github&logoColor=white)](https://github.com/Map1en/VRCX-0/releases/latest)
[![Downloads](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/Map1en/VRCX-0/badge-data/downloads.json&style=flat&color=4c566a&labelColor=1f2328)](https://github.com/Map1en/VRCX-0/releases)
[![Windows installer size](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/Map1en/VRCX-0/badge-data/windows-installer-size.json&style=flat&label=installer&color=4c566a&labelColor=1f2328&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2ZmZiI%2BPHBhdGggZD0iTTIuNCAyLjRoOC41djguNUgyLjR6TTEzLjEgMi40SDIxLjZ2OC41aC04LjV6TTIuNCAxMy4xaDguNVYyMS42SDIuNHpNMTMuMSAxMy4xSDIxLjZWMjEuNmgtOC41eiIvPjwvc3ZnPg%3D%3D)](https://github.com/Map1en/VRCX-0/releases/latest)
[![Discord](https://img.shields.io/discord/1494343220467994644?style=flat&logo=discord&logoColor=white&label=discord&color=5865f2&labelColor=1f2328)](https://discord.gg/fehKP3SVPN)
<br>
[![CI](https://img.shields.io/github/actions/workflow/status/Map1en/VRCX-0/ci.yml?branch=master&label=ci&style=flat&labelColor=1f2328)](https://github.com/Map1en/VRCX-0/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/Map1en/VRCX-0/badge-data/coverage.json&style=flat&color=4c566a&labelColor=1f2328)](https://github.com/Map1en/VRCX-0/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-GPL--3.0-4c566a?style=flat&labelColor=1f2328)](LICENSE)

[![Download](https://img.shields.io/badge/Download%20VRCX--0-4340a2?style=for-the-badge)](https://github.com/Map1en/VRCX-0/releases/latest)

Windows · macOS · Linux

![VRCX-0](images/screenshot-user-dialog.webp)

</div>

VRChat 데스크톱 도우미. 친구의 접속 상태와 위치를 확인하고, 만난 사람과 방문한 월드를 기록하고, 즐겨찾기를 관리하는 등 다양한 기능을 제공합니다.

VRCX-0는 VRCX의 이전 유지보수 담당자 중 한 명이 처음부터 다시 만든 VRCX입니다. Rust로 재구축해 더 빠르고 가벼우며, 몇 년치 기록이 쌓여도 쾌적합니다.

## 주요 특징

- **몇 년치 기록도 쾌적하게** — VRCX가 느려지는 데이터양도 VRCX-0에서는 쾌적하게 동작하며, 저사양 PC나 NAS급 미니 PC에서도 실행 가능
- **VRCX 대비 메모리 약 50%–70% 절감**
- **백그라운드 모드는 메모리 수십 MB**, 핵심 기능은 그대로 동작
- **아바타 하나보다 작은 용량** — 다운로드 10MB대, 설치 후 30MB대로 VRCX의 10분의 1 이하
- **간편한 마이그레이션** — VRCX 데이터베이스와 설정을 자동으로 가져오며, VRCX 쪽 데이터베이스는 수정하지 않아 언제든 되돌아갈 수 있음

### VRCX-0에만 있는 기능

- **AI 어시스턴트** — VRChat 소셜 생활을 한눈에. 자주 함께 노는 사람, 멀어지는 사람, 친구를 만나기 좋은 시간대까지. 사용 중인 AI 서비스를 연결하면 바로 사용 가능
- **활동** — 방문한 월드, 함께 있던 사람, 당시 스크린샷을 타임라인으로 돌아보기. 자주 마주친 사람도 확인 가능
- **사이드바 모드** — 좁은 사이드바로 친구 동향을 언제든 확인. Windows·macOS에서는 화면 가장자리 자동 숨김 지원
- **데스크톱 오버레이** — 데스크톱 모드 플레이어를 위한 알림 미니 창으로 시스템 알림을 대체. Windows 전용
- **월드 사이드바 고정** — 해당 월드의 공개 인스턴스와 친구가 있는 인스턴스를 언제든 확인하고 바로 참가
- **단축키** — 자주 쓰는 동작을 마우스 없이. Windows는 전역 단축키 지원
- **잠금** — 비밀번호로 화면을 잠가 개인정보 보호
- **공유** — 월드 컬렉션·월드·아바타·인스턴스 공유 링크 생성
- **게임 로그 보충** — VRCX-0가 꺼져 있던 동안의 게임 로그를 VRChat 자체 로그에서 보충

### 고급 사용자용

- **MCP 서버** — 외부 AI 도구에서 로컬 소셜 데이터를 직접 활용
- **통합 API** — 서드파티 앱에 게임 중 데이터를 실시간 제공
- **자체 호스팅 기록기 (실험적)** — 직접 운영하는 서버에서 실행하면 VRCX-0를 닫아 둔 동안에도 피드를 계속 기록하고, 다음에 열 때 자동으로 채워 넣음
- **헤드리스 모드** — UI 없이 실행. `crates/headless` 참고

### VRCX와의 차이

| 기능            | VRCX                                             | VRCX-0 (+ 는 추가된 기능)                                                              |
| --------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| **소셜 자동화** | 혼자 여부에 따라 상태 전환; 참가 요청 자동 응답  | + 시간 규칙, 우선순위가 있는 여러 상황 규칙, 종료 시 이전 상태로 복원                  |
| **알림**        | 데스크톱·TTS·XSOverlay·OVR Toolkit·손목 오버레이 | + 데스크톱 오버레이, Discord 호환 Webhook, 방해 금지 모드; 모든 채널에서 이벤트별 필터 |
| **VR 오버레이** | 브라우저 렌더링(100 MB 이상); OpenVR             | + 네이티브 렌더링(수십 MB); OpenXR(**WiVRn에서 실기기 테스트 완료**)                   |
| 스크린샷        | 메타데이터 보기·검색                             | + 그리드 보기, 즐겨찾기, 일괄 관리, ZIP 내보내기                                       |
| 아바타 상세     | 성능 등급과 파일 크기                            | + 상세 성능 지표를 플랫폼별 상한과 비교                                                |
| 백업            | VRChat 레지스트리 설정                           | + 데이터베이스 정기 백업, 원클릭 복원                                                  |
| 친구 위치       | 같은 인스턴스별로 묶어 표시                      | + 월드 보기                                                                            |
| 그룹 관리       | 공개 설정은 하나씩                               | + 일괄 탈퇴·일괄 공개 설정; 플레이어 목록에 그룹 역할 표시                             |
| 테마            | 내장 테마, 커스텀 CSS 파일                       | + 커뮤니티 테마, 배경 이미지, 앱 내 CSS 편집, 강조색                                   |
| 여러 계정       | 모든 계정의 게임 로그가 한데 섞임                | 게임 로그를 계정별로 따로 저장; 다른 계정으로 VRChat을 플레이해도 서로 영향 없음       |

VRCX의 나머지 기능은 VRCX-0에도 그대로 있습니다.

## 설치

[최신 릴리스](https://github.com/Map1en/VRCX-0/releases/latest)에서 사용 중인 플랫폼에 맞는 파일을 받으세요:

| 플랫폼                | 파일                                     |
| --------------------- | ---------------------------------------- |
| Windows               | `VRCX-0_<버전>_windows_x86_64_setup.exe` |
| macOS (Apple Silicon) | `VRCX-0_<버전>_macos_aarch64.dmg`        |
| macOS (Intel)         | `VRCX-0_<버전>_macos_x86_64.dmg`         |
| Linux                 | `.AppImage`, `.deb`, `.rpm`              |

macOS에서 처음 실행이 차단되면 **시스템 설정 → 개인정보 보호 및 보안**에서 **그래도 열기**를 클릭하세요.

### Linux

앱 화면의 하드웨어 가속은 기본적으로 꺼져 있으며, **설정 → 시스템 → 하드웨어 가속 (실험적)** 항목에서 켤 수 있습니다. 화면이 제대로 표시되지 않으면 VRCX-0이 자동으로 다시 끕니다. `WEBKIT_DISABLE_DMABUF_RENDERER`를 직접 설정한 경우 이 옵션은 표시되지 않습니다.

## 피드백

- 질문 및 소통: [Discord](https://discord.gg/fehKP3SVPN)
- 버그 제보 및 기능 요청: [GitHub Issues](https://github.com/Map1en/VRCX-0/issues)
- 개발 블로그: [blog.vrcx-0.dev](https://blog.vrcx-0.dev/en/)

## 소스에서 빌드

다음 단계는 VRCX-0 개발에 참여하거나 로컬에서 직접 빌드할 때 사용합니다. 기여하기 전에 [CONTRIBUTING.md](CONTRIBUTING.md)를 확인하세요.

필요 사항: Node.js ≥ 24.10, npm ≥ 11.5, rustup을 통해 설치한 안정 버전 Rust 툴체인.
Windows에서는 **Visual Studio Build Tools**를 설치하고 **"C++를 사용한 데스크톱 개발"** 을 선택해야 합니다.

```bash
git clone https://github.com/Map1en/VRCX-0
cd VRCX-0

npm install
```

개발 서버 실행:

```bash
npm run tauri:dev
```

릴리스 빌드 (서명 및 설치 프로그램 생성 생략):

```bash
npm run tauri:build -- --no-sign --no-bundle
```

## 라이선스

VRCX-0는 GNU General Public License v3.0 (GPLv3)에 따라 배포됩니다.

[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2FMap1en%2FVRCX-0.svg?type=shield)](https://app.fossa.com/projects/git%2Bgithub.com%2FMap1en%2FVRCX-0?ref=badge_large)

VRCX-0는 VRChat Inc.의 승인을 받은 프로젝트가 아닙니다. VRChat 및 관련된 모든 자산은 VRChat Inc.의 상표 또는 등록 상표입니다.
