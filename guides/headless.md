# Headless Mode

Headless mode runs VRCX-0's data backend without a window. It keeps your Feed
and friend data recording into the same database the desktop app uses, for
example on an always-on PC.

## Building

Release builds don't include it; build it from source with a stable Rust
toolchain:

```bash
cargo build --release -p vrcx-0-headless
```

The binary is at `target/release/vrcx-0-headless` (`.exe` on Windows).

## Running

```bash
vrcx-0-headless [--login | -l]
```

- Without arguments, it signs in with the session or password saved by
  VRCX-0. If that needs your input, such as a 2FA code, it exits with an error.
- `--login` / `-l` asks for your username or email, password, and 2FA code in
  the terminal.
- Press **Ctrl+C** to stop.

It uses the same data directory as the desktop app, including a custom data
directory set in the app. Errors are written to `error-headless.txt` in that
directory. Set the `RUST_LOG` environment variable to change console log
verbosity (default `vrcx_0=info`).
