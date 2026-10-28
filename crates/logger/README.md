# VRCX-0 Self-hosted Recorder (experimental)

**English** | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-Hant.md) | [日本語](README.ja-JP.md) | [한국어](README.ko-KR.md)

The Self-hosted Recorder runs on an always-on machine and records friend activity while VRCX-0 is closed. When VRCX-0 starts, the recorded activity is filled into the local Feed.

> [!WARNING]
> Experimental. The recorder logs in to VRChat with your account from a second IP address. Under VRChat's policies and security checks this may cause disconnects or repeated verification, and in the worst case account restrictions or a ban. Use at your own risk. Login details are only sent to your own recorder.

## Scope

- Filled in: friends going online and offline, location, status and avatar changes. Bio changes when **Keep friend bios up to date** is enabled in VRCX-0.
- One VRChat account per recorder.
- Not filled in:
    - about 30 seconds after VRCX-0 crashes, is force-closed, sleeps or loses its connection;
    - offline confirmations still pending when a recording ends;
    - changes while the recorder itself is disconnected from VRChat.

## Requirements

- A machine that stays on: Linux (x86_64 or ARM64), such as a NAS, VPS or Raspberry Pi, or a Windows PC (x86_64).
- Docker with Docker Compose v2 (the `docker compose` command). A standalone binary is also available.
- VRCX-0 must be able to reach the machine over the network.

## Install

### Install script

```sh
curl -fsSL https://raw.githubusercontent.com/Map1en/VRCX-0/master/crates/logger/install.sh | sh
```

The script asks for the install directory, release channel, port, listen address, retention, storage limit and password; press Enter to keep the default shown. It then starts the container and prints the address and password to enter in VRCX-0. Settings are stored in `.env` and the password in `password` inside the install directory.

- Update: run the script again. It asks only for the release channel, with the current one as the default, and keeps `.env`, `password` and `compose.yaml` as they are. To change other settings, edit `.env` and run `docker compose up -d` in the install directory.
- Stop: append `-s down` (`... | sh -s down`).
- If your user cannot run Docker, use `sudo sh`.

### Docker Compose

```sh
mkdir vrcx-0-logger && cd vrcx-0-logger
curl -fsSLO https://raw.githubusercontent.com/Map1en/VRCX-0/master/crates/logger/compose.yaml
printf '%s' 'your-password' > password
docker compose up -d
```

NAS interfaces (Synology Container Manager, Unraid and others): use the image `ghcr.io/map1en/vrcx-0-logger:latest`, map port `8787` and a folder to `/data`, and set `VRCX0_LOGGER_PASSWORD`. On Unraid, map `/data` to a cache or single-disk path such as `/mnt/cache/appdata/vrcx-0-logger`; SQLite can be corrupted on `/mnt/user` shares. If you put the password directly in a Compose file's `environment:`, write `$` as `$$`.

### Release channels

| Tag      | Use with                                      |
| -------- | --------------------------------------------- |
| `latest` | stable VRCX-0                                 |
| `beta`   | beta VRCX-0                                   |
| `x.y.z`  | a pinned version, for example `2.32.0-beta.1` |

A stable VRCX-0 only connects to a stable recorder.

### Standalone binary

Download `vrcx-0-logger_<version>_linux_<arch>` from [Releases](https://github.com/Map1en/VRCX-0/releases), set the password variable and run it. Use a service manager such as systemd to keep it running.

### Windows

Download `vrcx-0-logger_<version>_windows_x86_64.exe` from [Releases](https://github.com/Map1en/VRCX-0/releases) and run it. The window shows the address and a generated password to enter in VRCX-0, along with the listen address, port, data folder, retention and storage limit. Settings are saved in `%LOCALAPPDATA%\VRCX-0 Logger\logger.env`, and records go to the `data` folder next to it by default. The recorder runs while the window is open, and connection problems such as VRChat being unreachable are listed below the status.

To run it without a window, for example from Task Scheduler, start it with `--headless` and set the environment variables listed under Configuration.

### Configuration

With the install script or Docker Compose, edit `.env` in the install directory and run `docker compose up -d`. The password is in the `password` file.

| `.env` key                    | Default   | Description                                                  |
| ----------------------------- | --------- | ------------------------------------------------------------ |
| `VRCX0_LOGGER_TAG`            | `latest`  | Release channel.                                             |
| `VRCX0_LOGGER_PORT`           | `8787`    | Port on the host.                                            |
| `VRCX0_LOGGER_BIND`           | `0.0.0.0` | Host address to listen on.                                   |
| `VRCX0_LOGGER_RETENTION_DAYS` | unlimited | Delete records older than this many days.                    |
| `VRCX0_LOGGER_MAX_STORAGE_MB` | `1024`    | Delete the oldest records above this size; `0` for no limit. |

The standalone binary reads these environment variables; on NAS interfaces, set them on the container:

| Variable                      | Default                    | Description                                                  |
| ----------------------------- | -------------------------- | ------------------------------------------------------------ |
| `VRCX0_LOGGER_PASSWORD`       | required                   | At least 8 characters. Encrypts traffic and data.            |
| `VRCX0_LOGGER_PASSWORD_FILE`  |                            | Read the password from a file instead.                       |
| `VRCX0_LOGGER_HOST`           | `0.0.0.0`                  | Listen address.                                              |
| `VRCX0_LOGGER_PORT`           | `8787`                     | Listen port.                                                 |
| `VRCX0_LOGGER_DATA_DIR`       | `data` (`/data` in Docker) | Data directory.                                              |
| `VRCX0_LOGGER_RETENTION_DAYS` | unlimited                  | Delete records older than this many days.                    |
| `VRCX0_LOGGER_MAX_STORAGE_MB` | `1024`                     | Delete the oldest records above this size; `0` for no limit. |

In a container, leave `VRCX0_LOGGER_HOST`, `VRCX0_LOGGER_PORT` and `VRCX0_LOGGER_DATA_DIR` unset and change the port mapping instead.

## Connect from VRCX-0

**Tools → Self-hosted Recorder**:

1. Enable automatic backups.
2. Enter the recorder address, for example `http://192.168.1.10:8787`.
3. Enter the recorder password.
4. Log the recorder in to VRChat, including two-factor verification if required.

Traffic between VRCX-0 and the recorder is encrypted with the password. Do not expose the port to the internet; for remote access use a VPN such as Tailscale. On a VPS, set the listen address (`VRCX0_LOGGER_BIND` in `.env`) to the VPN address, or allow the port only through a firewall.

## Operation

- **Status bar**: an icon next to the proxy icon shows the recorder state. Orange: logging in, reconnecting, a different account or an unexpected response. Red: unreachable, wrong password, version mismatch, or VRChat needs a login or two-factor code.
- **Filling in**: runs automatically when VRCX-0 connects; **Fill in now** starts it manually. Closing VRCX-0 normally hands over to the recorder immediately.
- **Webhook**: Discord or any URL accepting POST. Sent when login stops, two-factor verification is needed, records cannot be saved, unsynced records are deleted by the storage limit, and when recording recovers. Each message starts with a type (`login`, `storage`, `recovered`, `test`) and includes the original error when there is one.
- **Health check**: `GET /health` returns 200 while the recorder can read its database. The image has no shell, so monitor it from outside the container.

## Upgrade

Run the install script again, or `docker compose pull && docker compose up -d`. Versions do not have to match: update the recorder when VRCX-0 says it needs an update. Until then VRCX-0 stops filling in, and recorded activity is kept.

## Troubleshooting

| Problem              | Check                                                                                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recorder unreachable | Container running, firewall allows the port, address correct. macOS: allow VRCX-0 under **Local Network**.                                            |
| Wrong password       | The password in VRCX-0 must match the recorder password.                                                                                              |
| Different account    | Log the recorder in with the account used in VRCX-0.                                                                                                  |
| Stable/beta mismatch | Use `latest` with stable VRCX-0 and `beta` with beta VRCX-0.                                                                                          |
| Logs                 | `docker compose logs` in the install directory. On Windows, errors are listed in the recorder window; with `--headless`, the log goes to the console. |

## Data and security

- Records and the VRChat login are stored in the data directory, encrypted with the password.
- **Remember password on the recorder** lets it log in again after the session expires; when off, only the session token is kept.
- Changing the password discards unsynced records, the VRChat login and the webhook. Fill in from VRCX-0 first, then edit `password`, run `docker compose up -d --force-recreate`, connect again in VRCX-0 with the new password and log the recorder in to VRChat again.
- Records are deleted from the recorder after VRCX-0 has pulled them.

## Removal

In VRCX-0, choose **Disconnect**: it fills in, logs the recorder out of VRChat and removes the recorder settings. Then run `docker compose down` and delete the install directory.

## License

Third-party license notices are attached to each release and included in the image under `/usr/share/licenses/vrcx-0-logger/`. To build the image yourself, place the release binaries at `crates/logger/dist/vrcx-0-logger-amd64` and `crates/logger/dist/vrcx-0-logger-arm64`, copy `LICENSE` and the release `THIRD_PARTY_NOTICES.txt` into `crates/logger/dist/`, then run `docker build crates/logger`.
