# Docker headless server

The Docker image builds from this repository checkout. Its database and saved VRChat collector session live in `vrcx-0-data` beside the checkout. A fresh data folder has no saved login; reusing an existing data folder resumes that server's saved collector session. The collector login is separate from the account signed in to the desktop app.

## Start

Install Docker with Compose, then clone the repository. Replace `REPOSITORY_URL` with the Git URL of the repository you want to build:

```sh
git clone REPOSITORY_URL VRCX-0
cd VRCX-0
```

Create a `.env` file in the repository folder containing a private database token. Generate one with `openssl rand -hex 32`, then add it like this:

```dotenv
VRCX_DATABASE_TOKEN=paste-generated-token-here
```

In Windows PowerShell, generate the token and write `.env` with:

```powershell
$bytes = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$rng.Dispose()
$token = [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
Set-Content -Encoding Ascii -NoNewline .env "VRCX_DATABASE_TOKEN=$token"
```

Optionally add `VRCX_DATABASE_PORT=9001` to `.env` to choose the host port; update the desktop URL to match.

On Linux, create the data folder and set its owner before starting:

```sh
mkdir -p vrcx-0-data
sudo chown 10001:10001 vrcx-0-data
```

Compose builds `Dockerfile.headless` from the checkout and starts the server:

```sh
docker compose -f compose.headless.yaml up -d --build
```

To build the image without starting it:

```sh
docker build -f Dockerfile.headless -t vrcx-0-headless:local .
```

The database is available on port `9001` by default. If the desktop app is on the same computer, use `http://localhost:9001`. If Linux reports a permission error for an existing data folder, repair its ownership with `sudo chown -R 10001:10001 vrcx-0-data`.

Keep the token private: it grants full read and write access to the database. Keep the endpoint on a trusted network or behind TLS.

## Connect and sign in

On the desktop app's login screen, open **App data storage**, choose the remote server option, enter the server URL and token, and save. If the app has already opened local storage, it restarts to use the server database. Local storage remains the default, so you can sign in normally without changing this option. Switching storage does not copy existing desktop history. Use the database import action to merge a legacy VRCX database snapshot into the server if needed.

When connected, choose **Sign in to collector** and enter the VRChat credentials for the account the server should use. Complete any verification prompt in the desktop app. The login request comes from the server's IP address. Starting Docker does not copy or use the desktop app's VRChat login. Once saved, the collector session resumes automatically while the same `vrcx-0-data` folder is kept.

You can also sign in from the server terminal. Stop the service first, run the interactive login, then start it again:

```sh
docker compose -f compose.headless.yaml stop collector
docker compose -f compose.headless.yaml run --rm collector --login
docker compose -f compose.headless.yaml up -d collector
```

## Update and troubleshoot

From the repository folder, pull the latest code and rebuild:

```sh
git pull
docker compose -f compose.headless.yaml up -d --build
```

See live logs with:

```sh
docker compose -f compose.headless.yaml logs -f collector
```

Restart with `docker compose -f compose.headless.yaml restart collector`. Stop with `docker compose -f compose.headless.yaml down`; this removes the container but keeps `vrcx-0-data`.

To deliberately reset the server, stop it and delete `vrcx-0-data`. This permanently removes the server database, saved collector login, and pending activity. Re-cloning the repository into a different location does not bring that data folder along; keep or back it up if you need the existing history or login. Stop the service before backing up or copying the folder, and keep the `pending-realtime` directory with the database so uncommitted batches can be replayed.
