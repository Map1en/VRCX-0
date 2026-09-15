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

VRCX-0는 VRCX의 이전 유지보수 담당자 중 한 명이 처음부터 다시 만든 버전으로, Rust 백엔드(Tauri + React) 기반으로 재작성되어 성능이 크게 향상되었습니다. 몇 년치 기록이 쌓여도 여전히 가볍게 동작하며, 메모리 사용량과 설치 용량 모두 기존 VRCX보다 크게 낮습니다.

첫 실행 시 기존 VRCX 데이터와 설정을 자동으로 가져오며, 원본 데이터는 수정되지 않아 언제든 되돌아갈 수 있습니다.

VRCX는 성숙하고 안정적인 버전이며, VRCX-0에서는 계속해서 새로운 기능을 개발하고 있습니다.

## 설치

[최신 릴리스](https://github.com/Map1en/VRCX-0/releases/latest)에서 사용 중인 플랫폼에 맞는 파일을 받으세요:

| 플랫폼                | 파일                                     |
| --------------------- | ---------------------------------------- |
| Windows               | `VRCX-0_<버전>_windows_x86_64_setup.exe` |
| macOS (Apple Silicon) | `VRCX-0_<버전>_macos_aarch64.dmg`        |
| macOS (Intel)         | `VRCX-0_<버전>_macos_x86_64.dmg`         |
| Linux                 | `.AppImage`, `.deb`, `.rpm`              |

한 번만 받으면 됩니다 — 이후에는 VRCX-0가 알아서 업데이트합니다.

## 주요 특징

- **몇 년치 기록에도 느려지지 않음** — VRCX가 눈에 띄게 느려지는 데이터양도 VRCX-0에서는 여전히 쾌적하게 동작하며, 저사양 PC나 NAS급 미니 PC에서도 무리 없이 실행됩니다
- **일반 사용 시 VRCX 대비 메모리 약 50%–70% 절감**
- **백그라운드 모드**를 켜면 메모리가 수십 MB까지 더 내려가면서도 모든 핵심 기능은 그대로 동작합니다
- **아바타 하나보다 작은 용량** — 설치 파일 10MB대, 설치 후 30MB대로 VRCX보다 10배 이상 작습니다
- **부담 없는 마이그레이션** — VRCX 데이터베이스와 설정을 자동으로 가져오며, 원본 데이터는 절대 수정되지 않습니다

### VRCX-0에만 있는 기능

- **AI 어시스턴트** — VRChat 생활을 되돌아보는 도우미. 자주 함께 노는 사람, 점점 멀어지는 사람, 친구를 만나기 좋은 시간대 등을 물어볼 수 있으며, 나만의 AI 서비스를 연결하면 바로 사용 가능
- **사이드바 모드** — 다른 일을 하면서 좁은 사이드바로 친구 동향을 확인. 큰 창을 오갈 필요가 없으며, Windows·macOS에서는 화면 가장자리에 붙여 자동으로 숨길 수 있습니다
- **단축키와 전역 단축키** — 페이지 이동·설정 열기·탭 전환을 마우스 없이 처리. Windows에서는 전역 단축키로 다른 앱을 쓰다가도 VRCX-0을 바로 불러오거나 숨길 수 있습니다
- **월드 컬렉션 공유** — 즐겨찾기 월드를 공유 페이지로 만들면 상대방이 둘러보기·열기·가져오기 가능. 월드·아바타 개별 공유 링크도 지원
- **MCP 서버** — 외부 AI 도구에서 로컬 소셜 데이터에 직접 접근 가능. AI 어시스턴트보다 훨씬 유연하며, 고급 사용자에게 추천
- **통합 API** — 서드파티 앱에 게임 중 룸 데이터를 실시간 제공, 향후 확장 예정
- **헤드리스 모드** — 고급 사용자용. `crates/headless` 참고

### VRCX와의 차이

| 기능            | VRCX                                                                                                             | VRCX-0 (+ 는 추가된 기능)                                                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **소셜 자동화** | 혼자일 때·누군가와 함께일 때 상태와 상태 메시지 전환(인스턴스 유형 한정 가능); 초대 요청 자동 응답               | + 시간 규칙(시간대·요일), 여러 상황 규칙(함께 있는 친구·인원 수·인스턴스 유형·즐겨찾기 월드, **우선순위 설정**), **종료 시 이전 상태로 복원** |
| **알림**        | 데스크톱·TTS·XSOverlay·OVR Toolkit·손목 오버레이(채널마다 지원 이벤트가 다르고, 이벤트별 필터는 오버레이만 가능) | + **Discord 호환 Webhook**, 방해 금지 모드; 모든 채널이 같은 이벤트를 지원하며 각각 이벤트별로 독립 설정                                      |
| **VR 오버레이** | 손목·헤드셋, 브라우저 렌더링(메모리 100 MB 이상); OpenVR                                                         | + OpenXR(**WiVRn에서 실기기 테스트 완료**); 네이티브 렌더링(메모리 수십 MB)                                                                   |
| 스크린샷        | 메타데이터 보기·검색                                                                                             | + 그리드 보기, 다중 선택, 일괄 삭제, ZIP 내보내기                                                                                             |
| 아바타 상세     | 성능 등급과 파일 크기                                                                                            | + 삼각형·텍스처 메모리·머티리얼·본·PhysBone·파티클·콜라이더(플랫폼별 상한과 비교)                                                             |
| 백업            | VRChat 레지스트리 설정                                                                                           | + 데이터베이스 정기 백업, 다중 버전, 원클릭 복원                                                                                              |
| 그룹 관리       | 프로필에서 순서 변경, 공개 설정은 하나씩                                                                         | + "내 그룹" 페이지(일괄 탈퇴, 일괄 공개 설정)                                                                                                 |
| 테마            | 내장 테마, 커스텀 CSS(파일을 직접 배치)                                                                          | + 커뮤니티 테마 카탈로그, 배경 이미지, 앱 내 CSS 편집기, 강조색                                                                               |
| 게임 로그       | 모든 계정의 기록이 한데 섞임                                                                                     | 계정별로 따로 저장                                                                                                                            |

VRCX의 나머지 기능은 VRCX-0에도 그대로 있습니다.

## 라이선스

VRCX-0는 GNU General Public License v3.0 (GPLv3)에 따라 배포됩니다.

[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2FMap1en%2FVRCX-0.svg?type=large)](https://app.fossa.com/projects/git%2Bgithub.com%2FMap1en%2FVRCX-0?ref=badge_large)

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
