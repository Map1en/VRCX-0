use std::io;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Mutex};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use vrcx_0_host::Error;

#[cfg(windows)]
use base64::{engine::general_purpose::STANDARD as B64, Engine};

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TtsVoice {
    pub id: String,
    pub name: String,
    pub language: String,
}

pub trait TtsEngine: Send + Sync {
    fn voices(&self) -> Vec<TtsVoice>;

    fn speak(&self, text: &str, voice_id: Option<&str>) -> Result<(), Error>;
}

#[derive(Debug)]
struct TtsRequest {
    text: String,
    voice_id: Option<String>,
}

pub struct SystemTtsEngine {
    sender: Mutex<mpsc::Sender<TtsRequest>>,
}

impl Default for SystemTtsEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl SystemTtsEngine {
    pub fn new() -> Self {
        let (sender, receiver) = mpsc::channel();
        if let Err(error) = thread::Builder::new()
            .name("vrcx-0-tts".into())
            .spawn(move || run_tts_worker(receiver))
        {
            tracing::warn!("failed to start TTS worker: {error}");
        }
        Self {
            sender: Mutex::new(sender),
        }
    }
}

impl TtsEngine for SystemTtsEngine {
    fn voices(&self) -> Vec<TtsVoice> {
        platform_voices()
    }

    fn speak(&self, text: &str, voice_id: Option<&str>) -> Result<(), Error> {
        let request = TtsRequest {
            text: text.to_string(),
            voice_id: voice_id
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string),
        };
        let sender = self
            .sender
            .lock()
            .map_err(|error| Error::Custom(format!("TTS worker lock poisoned: {error}")))?;
        sender
            .send(request)
            .map_err(|error| Error::Custom(format!("TTS worker unavailable: {error}")))
    }
}

fn run_tts_worker(receiver: mpsc::Receiver<TtsRequest>) {
    let mut child = None;
    loop {
        let request = if child.is_some() {
            match receiver.try_recv() {
                Ok(request) => Some(request),
                Err(mpsc::TryRecvError::Empty) => None,
                Err(mpsc::TryRecvError::Disconnected) => break,
            }
        } else {
            match receiver.recv() {
                Ok(request) => Some(request),
                Err(_) => break,
            }
        };

        if let Some(request) = request {
            stop_child(&mut child);
            if !request.text.trim().is_empty() {
                match spawn_tts_child(&request.text, request.voice_id.as_deref()) {
                    Ok(next) => child = Some(next),
                    Err(error) => warn_tts_spawn_once(&error),
                }
            }
        }

        if let Some(current) = child.as_mut() {
            match current.try_wait() {
                Ok(Some(_)) => child = None,
                Ok(None) => thread::sleep(Duration::from_millis(50)),
                Err(error) => {
                    warn_tts_spawn_once(&error);
                    child = None;
                }
            }
        }
    }
    stop_child(&mut child);
}

fn stop_child(child: &mut Option<Child>) {
    if let Some(mut current) = child.take() {
        let _ = current.kill();
        let _ = current.wait();
    }
}

fn warn_tts_spawn_once(error: &io::Error) {
    static WARNED: AtomicBool = AtomicBool::new(false);
    if !WARNED.swap(true, Ordering::SeqCst) {
        tracing::warn!("native TTS command failed: {error}");
    }
}

#[cfg(windows)]
fn spawn_tts_child(text: &str, voice_id: Option<&str>) -> io::Result<Child> {
    let text_b64 = B64.encode(text.as_bytes());
    let voice_b64 = B64.encode(voice_id.unwrap_or_default().as_bytes());
    let script = format!(
        r#"
Add-Type -AssemblyName System.Speech
$text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{text_b64}'))
$voice = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{voice_b64}'))
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {{
    if ($voice.Trim().Length -gt 0) {{
        try {{ $speaker.SelectVoice($voice) }} catch {{ }}
    }}
    $speaker.Speak($text) | Out-Null
}} finally {{
    $speaker.Dispose()
}}
"#
    );
    spawn_powershell_script(&script)
}

#[cfg(target_os = "macos")]
fn spawn_tts_child(text: &str, voice_id: Option<&str>) -> io::Result<Child> {
    let mut command = Command::new("say");
    if let Some(voice_id) = voice_id.map(str::trim).filter(|value| !value.is_empty()) {
        command.args(["-v", voice_id]);
    }
    command
        .arg("--")
        .arg(text)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
}

#[cfg(all(not(windows), not(target_os = "macos")))]
fn spawn_tts_child(text: &str, _voice_id: Option<&str>) -> io::Result<Child> {
    Command::new("spd-say")
        .arg("--")
        .arg(text)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
}

#[cfg(windows)]
fn platform_voices() -> Vec<TtsVoice> {
    let script = r#"
Add-Type -AssemblyName System.Speech
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    @($speaker.GetInstalledVoices() | ForEach-Object {
        $info = $_.VoiceInfo
        [pscustomobject]@{
            id = $info.Name
            name = $info.Name
            language = $info.Culture.Name
        }
    }) | ConvertTo-Json -Compress
} finally {
    $speaker.Dispose()
}
"#;
    match powershell_output(script) {
        Ok(output) => parse_windows_voices_json(&output).unwrap_or_default(),
        Err(error) => {
            tracing::debug!("failed to list native TTS voices: {error}");
            Vec::new()
        }
    }
}

#[cfg(target_os = "macos")]
fn platform_voices() -> Vec<TtsVoice> {
    match Command::new("say").args(["-v", "?"]).output() {
        Ok(output) if output.status.success() => parse_macos_voices(&output.stdout),
        Ok(output) => {
            tracing::debug!("failed to list macOS TTS voices: status={}", output.status);
            Vec::new()
        }
        Err(error) => {
            tracing::debug!("failed to list macOS TTS voices: {error}");
            Vec::new()
        }
    }
}

#[cfg(all(not(windows), not(target_os = "macos")))]
fn platform_voices() -> Vec<TtsVoice> {
    Vec::new()
}

#[cfg(windows)]
fn powershell_output(script: &str) -> io::Result<Vec<u8>> {
    let output = powershell_command(script).output()?;
    if output.status.success() {
        Ok(output.stdout)
    } else {
        Err(io::Error::other(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ))
    }
}

#[cfg(windows)]
fn spawn_powershell_script(script: &str) -> io::Result<Child> {
    powershell_command(script)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
}

#[cfg(windows)]
fn powershell_command(script: &str) -> Command {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let mut bytes = Vec::with_capacity(script.len() * 2);
    for unit in script.encode_utf16() {
        bytes.extend_from_slice(&unit.to_le_bytes());
    }
    let mut command = Command::new("powershell.exe");
    command.args([
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        &B64.encode(bytes),
    ]);
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

#[cfg(windows)]
fn parse_windows_voices_json(value: &[u8]) -> Result<Vec<TtsVoice>, serde_json::Error> {
    let value = serde_json::from_slice::<serde_json::Value>(value)?;
    if let Some(items) = value.as_array() {
        return items
            .iter()
            .cloned()
            .map(serde_json::from_value::<TtsVoice>)
            .collect();
    }
    serde_json::from_value::<TtsVoice>(value).map(|voice| vec![voice])
}

#[cfg(any(target_os = "macos", test))]
fn parse_macos_voices(value: &[u8]) -> Vec<TtsVoice> {
    String::from_utf8_lossy(value)
        .lines()
        .filter_map(|line| {
            let (id, language) = parse_macos_voice_line(line)?;
            let name = id.clone();
            Some(TtsVoice { id, name, language })
        })
        .collect()
}

#[cfg(any(target_os = "macos", test))]
fn parse_macos_voice_line(line: &str) -> Option<(String, String)> {
    let mut token_start = None;
    for (index, value) in line
        .char_indices()
        .chain(std::iter::once((line.len(), ' ')))
    {
        if value.is_whitespace() {
            let Some(start) = token_start.take() else {
                continue;
            };
            let token = &line[start..index];
            if !is_macos_locale_token(token) {
                continue;
            }
            let id = line[..start].trim();
            if id.is_empty() {
                return None;
            }
            return Some((id.to_string(), token.to_string()));
        } else if token_start.is_none() {
            token_start = Some(index);
        }
    }
    None
}

#[cfg(any(target_os = "macos", test))]
fn is_macos_locale_token(value: &str) -> bool {
    let mut chars = value.chars();
    if !chars.next().is_some_and(|value| value.is_ascii_lowercase())
        || !chars.next().is_some_and(|value| value.is_ascii_lowercase())
    {
        return false;
    }
    if !chars
        .next()
        .is_some_and(|value| value == '_' || value == '-')
    {
        return false;
    }
    let mut region_len = 0;
    for value in chars {
        if !value.is_ascii_alphanumeric() && value != '_' && value != '-' {
            return false;
        }
        region_len += 1;
    }
    region_len >= 2
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn windows_voice_json_accepts_array() {
        let voices = parse_windows_voices_json(
            br#"[{"id":"Microsoft Zira Desktop","name":"Microsoft Zira Desktop","language":"en-US"}]"#,
        )
        .unwrap();

        assert_eq!(
            voices,
            vec![TtsVoice {
                id: "Microsoft Zira Desktop".into(),
                name: "Microsoft Zira Desktop".into(),
                language: "en-US".into(),
            }]
        );
    }

    #[test]
    fn macos_voice_list_preserves_multi_word_voice_name() {
        let voices = parse_macos_voices(
            b"Alex                en_US    # Hello\nBad News            en_US    # The light\nPipe Organ          en-US    # Chord\n",
        );

        assert_eq!(
            voices,
            vec![
                TtsVoice {
                    id: "Alex".into(),
                    name: "Alex".into(),
                    language: "en_US".into(),
                },
                TtsVoice {
                    id: "Bad News".into(),
                    name: "Bad News".into(),
                    language: "en_US".into(),
                },
                TtsVoice {
                    id: "Pipe Organ".into(),
                    name: "Pipe Organ".into(),
                    language: "en-US".into(),
                }
            ]
        );
    }

    #[test]
    fn macos_voice_list_ignores_lines_without_locale() {
        assert!(parse_macos_voices(b"Good News           # missing locale\n").is_empty());
    }
}
