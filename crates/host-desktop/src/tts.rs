use std::sync::{mpsc, Mutex};
use std::thread;
use std::time::Duration;

#[cfg(windows)]
use std::collections::HashSet;
#[cfg(all(not(windows), not(target_os = "macos")))]
use std::io;
#[cfg(all(not(windows), not(target_os = "macos")))]
use std::process::{Child, Command, Stdio};
#[cfg(not(target_os = "macos"))]
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};

use vrcx_0_platform::Error;

pub const DEFAULT_TTS_VOLUME: u8 = 100;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TtsVoice {
    pub id: String,
    pub name: String,
    pub language: String,
}

pub trait TtsEngine: Send + Sync {
    fn voices(&self) -> Vec<TtsVoice>;

    fn speak(&self, text: &str, voice_id: Option<&str>, volume: u8) -> Result<(), Error>;
}

#[derive(Debug)]
struct TtsRequest {
    text: String,
    voice_id: Option<String>,
    volume: u8,
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

    fn speak(&self, text: &str, voice_id: Option<&str>, volume: u8) -> Result<(), Error> {
        let request = TtsRequest {
            text: text.to_string(),
            voice_id: voice_id
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string),
            volume: volume.min(DEFAULT_TTS_VOLUME),
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

#[cfg(all(not(windows), not(target_os = "macos")))]
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
            if !request.text.trim().is_empty() && request.volume > 0 {
                match spawn_tts_child(&request.text, request.voice_id.as_deref(), request.volume) {
                    Ok(next) => child = Some(next),
                    Err(error) => warn_tts_io_once(&error),
                }
            }
        }

        if let Some(current) = child.as_mut() {
            match current.try_wait() {
                Ok(Some(_)) => child = None,
                Ok(None) => thread::sleep(Duration::from_millis(50)),
                Err(error) => {
                    warn_tts_io_once(&error);
                    child = None;
                }
            }
        }
    }
    stop_child(&mut child);
}

#[cfg(windows)]
fn run_tts_worker(receiver: mpsc::Receiver<TtsRequest>) {
    let mut synthesizer = match WindowsTtsSynthesizer::new() {
        Ok(synthesizer) => synthesizer,
        Err(error) => {
            tracing::warn!("failed to initialize native TTS: {error}");
            return;
        }
    };

    loop {
        let speaking = match synthesizer.is_speaking() {
            Ok(speaking) => speaking,
            Err(error) => {
                warn_windows_tts_status_once(&error);
                false
            }
        };
        let request = if speaking {
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
            if let Err(error) = synthesizer.stop() {
                warn_windows_tts_stop_once(&error);
            }
            if !request.text.trim().is_empty() && request.volume > 0 {
                if let Err(error) =
                    synthesizer.speak(&request.text, request.voice_id.as_deref(), request.volume)
                {
                    warn_windows_tts_speak_once(&error);
                }
            }
        }

        if synthesizer.is_speaking().unwrap_or(false) {
            thread::sleep(Duration::from_millis(50));
        }
    }
    let _ = synthesizer.stop();
}

#[cfg(target_os = "macos")]
fn run_tts_worker(receiver: mpsc::Receiver<TtsRequest>) {
    use objc2::rc::autoreleasepool;
    use objc2_avf_audio::{
        AVSpeechBoundary, AVSpeechSynthesisVoice, AVSpeechSynthesizer, AVSpeechUtterance,
    };
    use objc2_foundation::NSString;

    let synthesizer = autoreleasepool(|_| unsafe { AVSpeechSynthesizer::new() });
    loop {
        let request = if unsafe { synthesizer.isSpeaking() } {
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
            unsafe {
                synthesizer.stopSpeakingAtBoundary(AVSpeechBoundary::Immediate);
            }
            if !request.text.trim().is_empty() && request.volume > 0 {
                autoreleasepool(|_| unsafe {
                    let text = NSString::from_str(&request.text);
                    let utterance = AVSpeechUtterance::speechUtteranceWithString(&text);
                    utterance.setVolume(f32::from(request.volume) / 100.0);
                    if let Some(voice_id) = request.voice_id.as_deref() {
                        let voices = AVSpeechSynthesisVoice::speechVoices();
                        if let Some(voice) = voices
                            .iter()
                            .find(|voice| voice.name().to_string() == voice_id)
                        {
                            utterance.setVoice(Some(&voice));
                        }
                    }
                    synthesizer.speakUtterance(&utterance);
                });
            }
        }

        if unsafe { synthesizer.isSpeaking() } {
            thread::sleep(Duration::from_millis(50));
        }
    }
    unsafe {
        synthesizer.stopSpeakingAtBoundary(AVSpeechBoundary::Immediate);
    }
}

#[cfg(all(not(windows), not(target_os = "macos")))]
fn stop_child(child: &mut Option<Child>) {
    if let Some(mut current) = child.take() {
        let _ = current.kill();
        let _ = current.wait();
    }
}

#[cfg(all(not(windows), not(target_os = "macos")))]
fn warn_tts_io_once(error: &io::Error) {
    static WARNED: AtomicBool = AtomicBool::new(false);
    if !WARNED.swap(true, Ordering::SeqCst) {
        tracing::warn!("native TTS failed: {error}");
    }
}

#[cfg(windows)]
fn warn_windows_tts_status_once(error: &windows::core::Error) {
    static WARNED: AtomicBool = AtomicBool::new(false);
    if !WARNED.swap(true, Ordering::SeqCst) {
        tracing::warn!("failed to query native TTS status: {error}");
    }
}

#[cfg(windows)]
fn warn_windows_tts_stop_once(error: &windows::core::Error) {
    static WARNED: AtomicBool = AtomicBool::new(false);
    if !WARNED.swap(true, Ordering::SeqCst) {
        tracing::warn!("failed to stop native TTS: {error}");
    }
}

#[cfg(windows)]
fn warn_windows_tts_speak_once(error: &windows::core::Error) {
    static WARNED: AtomicBool = AtomicBool::new(false);
    if !WARNED.swap(true, Ordering::SeqCst) {
        tracing::warn!("failed to play native TTS: {error}");
    }
}

#[cfg(windows)]
fn warn_windows_tts_select_once(error: &windows::core::Error) {
    static WARNED: AtomicBool = AtomicBool::new(false);
    if !WARNED.swap(true, Ordering::SeqCst) {
        tracing::warn!("failed to select native TTS voice: {error}");
    }
}

#[cfg(windows)]
struct ComApartment {
    uninitialize: bool,
}

#[cfg(windows)]
impl ComApartment {
    fn initialize() -> windows::core::Result<Self> {
        use windows::Win32::Foundation::RPC_E_CHANGED_MODE;
        use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

        let status = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        if status.is_ok() {
            Ok(Self { uninitialize: true })
        } else if status == RPC_E_CHANGED_MODE {
            Ok(Self {
                uninitialize: false,
            })
        } else {
            Err(status.into())
        }
    }
}

#[cfg(windows)]
impl Drop for ComApartment {
    fn drop(&mut self) {
        if self.uninitialize {
            unsafe { windows::Win32::System::Com::CoUninitialize() };
        }
    }
}

#[cfg(windows)]
struct WindowsTtsSynthesizer {
    voice: windows::Win32::Media::Speech::ISpeechVoice,
    default_voice: Option<windows::Win32::Media::Speech::ISpeechObjectToken>,
    voices: Vec<WindowsVoiceToken>,
    missing_voices: HashSet<String>,
    _apartment: ComApartment,
}

#[cfg(windows)]
impl WindowsTtsSynthesizer {
    fn new() -> windows::core::Result<Self> {
        let apartment = ComApartment::initialize()?;
        let voice = create_windows_voice()?;
        let default_voice = match unsafe { voice.Voice() } {
            Ok(default_voice) => Some(default_voice),
            Err(error) => {
                tracing::debug!("native TTS has no default voice: {error}");
                None
            }
        };
        let voices = load_windows_voice_tokens(&voice);
        Ok(Self {
            voice,
            default_voice,
            voices,
            missing_voices: HashSet::new(),
            _apartment: apartment,
        })
    }

    fn is_speaking(&self) -> windows::core::Result<bool> {
        unsafe { self.voice.WaitUntilDone(0) }.map(|done| !done.as_bool())
    }

    fn stop(&self) -> windows::core::Result<()> {
        use windows::core::BSTR;
        use windows::Win32::Media::Speech::{
            SVSFPurgeBeforeSpeak, SVSFlagsAsync, SpeechVoiceSpeakFlags,
        };

        let flags = SpeechVoiceSpeakFlags(SVSFlagsAsync.0 | SVSFPurgeBeforeSpeak.0);
        unsafe { self.voice.Speak(&BSTR::new(), flags) }.map(|_| ())
    }

    fn speak(
        &mut self,
        text: &str,
        voice_id: Option<&str>,
        volume: u8,
    ) -> windows::core::Result<()> {
        use windows::core::BSTR;
        use windows::Win32::Media::Speech::{
            SVSFIsNotXML, SVSFPurgeBeforeSpeak, SVSFlagsAsync, SpeechVoiceSpeakFlags,
        };

        if let Some(default_voice) = self.default_voice.as_ref() {
            let _ = unsafe { self.voice.putref_Voice(default_voice) };
        }
        if let Some(voice_id) = voice_id {
            self.select_voice(voice_id);
        }
        unsafe { self.voice.SetVolume(i32::from(volume)) }?;
        let flags =
            SpeechVoiceSpeakFlags(SVSFlagsAsync.0 | SVSFPurgeBeforeSpeak.0 | SVSFIsNotXML.0);
        unsafe { self.voice.Speak(&BSTR::from(text), flags) }.map(|_| ())
    }

    fn select_voice(&mut self, voice_id: &str) {
        match self.try_select_voice(voice_id) {
            VoiceSelection::Selected | VoiceSelection::Failed => return,
            VoiceSelection::NotFound => {}
        }
        if self.missing_voices.contains(voice_id) {
            return;
        }
        self.voices = load_windows_voice_tokens(&self.voice);
        self.missing_voices.clear();
        if matches!(self.try_select_voice(voice_id), VoiceSelection::NotFound) {
            self.missing_voices.insert(voice_id.to_string());
        }
    }

    fn try_select_voice(&self, voice_id: &str) -> VoiceSelection {
        let Some(voice) = self.voices.iter().find(|voice| voice.name == voice_id) else {
            return VoiceSelection::NotFound;
        };
        match unsafe { self.voice.putref_Voice(&voice.token) } {
            Ok(()) => VoiceSelection::Selected,
            Err(error) => {
                warn_windows_tts_select_once(&error);
                VoiceSelection::Failed
            }
        }
    }
}

#[cfg(windows)]
enum VoiceSelection {
    Selected,
    Failed,
    NotFound,
}

#[cfg(windows)]
struct WindowsVoiceToken {
    name: String,
    language: String,
    token: windows::Win32::Media::Speech::ISpeechObjectToken,
}

#[cfg(windows)]
const SPERR_NOT_FOUND: windows::core::HRESULT = windows::core::HRESULT(0x8004503A_u32 as i32);

#[cfg(all(not(windows), not(target_os = "macos")))]
fn spawn_tts_child(text: &str, _voice_id: Option<&str>, volume: u8) -> io::Result<Child> {
    Command::new("spd-say")
        .args(["--volume", &speech_dispatcher_volume(volume).to_string()])
        .arg("--")
        .arg(text)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
}

#[cfg(any(all(not(windows), not(target_os = "macos")), test))]
fn speech_dispatcher_volume(volume: u8) -> i16 {
    i16::from(volume.min(DEFAULT_TTS_VOLUME)) * 2 - 100
}

#[cfg(windows)]
fn platform_voices() -> Vec<TtsVoice> {
    match load_windows_voices() {
        Ok(voices) => voices,
        Err(error) => {
            tracing::warn!("failed to list native TTS voices: {error}");
            Vec::new()
        }
    }
}

#[cfg(windows)]
fn load_windows_voices() -> windows::core::Result<Vec<TtsVoice>> {
    let _apartment = ComApartment::initialize()?;
    let voice = create_windows_voice()?;
    Ok(load_windows_voice_tokens(&voice)
        .into_iter()
        .map(|voice| TtsVoice {
            id: voice.name.clone(),
            name: voice.name,
            language: voice.language,
        })
        .collect())
}

#[cfg(windows)]
fn create_windows_voice() -> windows::core::Result<windows::Win32::Media::Speech::ISpeechVoice> {
    use windows::Win32::Media::Speech::SpVoice;
    use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};

    unsafe { CoCreateInstance(&SpVoice, None, CLSCTX_ALL) }
}

#[cfg(windows)]
fn load_windows_voice_tokens(
    voice: &windows::Win32::Media::Speech::ISpeechVoice,
) -> Vec<WindowsVoiceToken> {
    let mut voices = Vec::new();
    match desktop_windows_voice_tokens(voice) {
        Ok(tokens) => append_windows_voice_tokens(&mut voices, &tokens, "Desktop"),
        Err(error) => tracing::warn!("failed to enumerate Desktop TTS voices: {error}"),
    }
    match one_core_windows_voice_tokens() {
        Ok(tokens) => append_windows_voice_tokens(&mut voices, &tokens, "OneCore"),
        Err(error) if error.code() == SPERR_NOT_FOUND => {
            tracing::debug!("OneCore TTS voice category is unavailable: {error}");
        }
        Err(error) => tracing::warn!("failed to enumerate OneCore TTS voices: {error}"),
    }
    let mut names = HashSet::new();
    voices.retain(|voice| names.insert(voice.name.clone()));
    voices
}

#[cfg(windows)]
fn desktop_windows_voice_tokens(
    voice: &windows::Win32::Media::Speech::ISpeechVoice,
) -> windows::core::Result<windows::Win32::Media::Speech::ISpeechObjectTokens> {
    let empty = windows::core::BSTR::new();
    unsafe { voice.GetVoices(&empty, &empty) }
}

#[cfg(windows)]
fn one_core_windows_voice_tokens(
) -> windows::core::Result<windows::Win32::Media::Speech::ISpeechObjectTokens> {
    use windows::core::BSTR;
    use windows::Win32::Foundation::VARIANT_FALSE;
    use windows::Win32::Media::Speech::{ISpeechObjectTokenCategory, SpObjectTokenCategory};
    use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};

    const ONE_CORE_VOICE_CATEGORY: &str =
        "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Speech_OneCore\\Voices";

    let category: ISpeechObjectTokenCategory =
        unsafe { CoCreateInstance(&SpObjectTokenCategory, None, CLSCTX_ALL) }?;
    unsafe { category.SetId(&BSTR::from(ONE_CORE_VOICE_CATEGORY), VARIANT_FALSE) }?;
    let empty = BSTR::new();
    unsafe { category.EnumerateTokens(&empty, &empty) }
}

#[cfg(windows)]
fn append_windows_voice_tokens(
    voices: &mut Vec<WindowsVoiceToken>,
    tokens: &windows::Win32::Media::Speech::ISpeechObjectTokens,
    category: &str,
) {
    let count = match unsafe { tokens.Count() } {
        Ok(count) => count,
        Err(error) => {
            tracing::warn!("failed to count {category} TTS voice tokens: {error}");
            return;
        }
    };
    for index in 0..count {
        match unsafe { tokens.Item(index) }.and_then(windows_voice_from_token) {
            Ok(voice) => voices.push(voice),
            Err(error) => {
                tracing::warn!("failed to read {category} TTS voice token {index}: {error}");
            }
        }
    }
}

#[cfg(windows)]
fn windows_voice_from_token(
    token: windows::Win32::Media::Speech::ISpeechObjectToken,
) -> windows::core::Result<WindowsVoiceToken> {
    use windows::core::BSTR;

    let name = unsafe { token.GetDescription(0) }?.to_string();
    let language = unsafe { token.GetAttribute(&BSTR::from("Language")) }
        .ok()
        .and_then(|value| sapi_language_lcid(&value.to_string()))
        .and_then(windows_locale_name)
        .unwrap_or_default();
    Ok(WindowsVoiceToken {
        name,
        language,
        token,
    })
}

#[cfg(windows)]
fn sapi_language_lcid(value: &str) -> Option<u32> {
    u32::from_str_radix(value.split(';').next()?.trim(), 16).ok()
}

#[cfg(windows)]
fn windows_locale_name(lcid: u32) -> Option<String> {
    use windows::Win32::Globalization::LCIDToLocaleName;

    let mut locale_name = [0_u16; 85];
    let length = unsafe { LCIDToLocaleName(lcid, Some(&mut locale_name), 0) };
    (length > 1).then(|| String::from_utf16_lossy(&locale_name[..length as usize - 1]))
}

#[cfg(target_os = "macos")]
fn platform_voices() -> Vec<TtsVoice> {
    use objc2::rc::autoreleasepool;
    use objc2_avf_audio::AVSpeechSynthesisVoice;

    autoreleasepool(|_| unsafe {
        AVSpeechSynthesisVoice::speechVoices()
            .iter()
            .map(|voice| TtsVoice {
                id: voice.name().to_string(),
                name: voice.name().to_string(),
                language: voice.language().to_string(),
            })
            .collect()
    })
}

#[cfg(all(not(windows), not(target_os = "macos")))]
fn platform_voices() -> Vec<TtsVoice> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn sapi_language_uses_first_hex_lcid() {
        assert_eq!(sapi_language_lcid("409"), Some(0x409));
        assert_eq!(sapi_language_lcid("411;409"), Some(0x411));
        assert_eq!(sapi_language_lcid("invalid"), None);
    }

    #[test]
    fn speech_dispatcher_volume_maps_ui_range() {
        assert_eq!(speech_dispatcher_volume(0), -100);
        assert_eq!(speech_dispatcher_volume(50), 0);
        assert_eq!(speech_dispatcher_volume(100), 100);
        assert_eq!(speech_dispatcher_volume(255), 100);
    }
}
