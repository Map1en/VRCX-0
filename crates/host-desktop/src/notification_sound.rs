//! Plays notification sounds on the desktop host, independently of the webview.

use std::borrow::Cow;
use std::collections::VecDeque;
use std::fs::File;
use std::io::{Cursor, Read};
use std::path::Path;
use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use rodio::buffer::SamplesBuffer;
use rodio::source::UniformSourceIterator;
use rodio::{
    ChannelCount, Decoder, DeviceSinkBuilder, MixerDeviceSink, Player, SampleRate, Source,
};
pub use vrcx_0_contracts::{NotificationSoundRule, NotificationSoundSource};

const BUILTIN_SOUNDS: &[(&str, &[u8])] = &[
    (
        "join_01_chime",
        include_bytes!("../assets/notification-sounds/join_01_chime.wav"),
    ),
    (
        "join_03_arp",
        include_bytes!("../assets/notification-sounds/join_03_arp.wav"),
    ),
    (
        "leave_01_chime",
        include_bytes!("../assets/notification-sounds/leave_01_chime.wav"),
    ),
    (
        "leave_03_arp",
        include_bytes!("../assets/notification-sounds/leave_03_arp.wav"),
    ),
    (
        "notify_01_ding",
        include_bytes!("../assets/notification-sounds/notify_01_ding.wav"),
    ),
    (
        "notify_02_double",
        include_bytes!("../assets/notification-sounds/notify_02_double.wav"),
    ),
    (
        "notify_03_glass",
        include_bytes!("../assets/notification-sounds/notify_03_glass.wav"),
    ),
];
const MAX_QUEUED_SOUNDS: usize = 4;
const MAX_EVENT_AGE: Duration = Duration::from_secs(3);
const PREVIEW_TIMEOUT: Duration = Duration::from_secs(5);
const PLAYBACK_POLL: Duration = Duration::from_millis(100);
const OUTPUT_DRAIN: Duration = Duration::from_millis(100);
const MAX_FILE_BYTES: u64 = 16 * 1024 * 1024;
const CHANNELS: ChannelCount = ChannelCount::new(2).unwrap();
const SAMPLE_RATE: SampleRate = SampleRate::new(48_000).unwrap();
const MAX_SAMPLES: usize = CHANNELS.get() as usize * SAMPLE_RATE.get() as usize * 10;

pub type NotificationSoundGuard = Arc<dyn Fn() -> bool + Send + Sync>;

enum RequestKind {
    Automatic(NotificationSoundGuard),
    Preview(mpsc::Sender<Result<(), String>>),
}

struct Request {
    rule: NotificationSoundRule,
    queued_at: Instant,
    kind: RequestKind,
}

impl Request {
    fn check_current(&self) -> Result<(), String> {
        match &self.kind {
            RequestKind::Automatic(allowed)
                if self.queued_at.elapsed() > MAX_EVENT_AGE || !allowed() =>
            {
                Err("Notification sound is no longer applicable".into())
            }
            RequestKind::Preview(_) if self.queued_at.elapsed() >= PREVIEW_TIMEOUT => {
                Err("Sound preview expired".into())
            }
            _ => Ok(()),
        }
    }
}

#[derive(Default)]
struct SoundQueue {
    automatic: VecDeque<Request>,
    preview: Option<Request>,
    shutdown: bool,
}

#[derive(Default)]
struct Mailbox {
    queue: Mutex<SoundQueue>,
    wake: Condvar,
}

pub struct NotificationSoundPlayer {
    mailbox: Arc<Mailbox>,
}

impl Default for NotificationSoundPlayer {
    fn default() -> Self {
        Self::new()
    }
}

impl NotificationSoundPlayer {
    pub fn new() -> Self {
        let mailbox = Arc::new(Mailbox::default());
        let worker_mailbox = Arc::clone(&mailbox);
        if let Err(error) = thread::Builder::new()
            .name("vrcx-0-notification-sound".into())
            .spawn(move || run_worker(worker_mailbox))
        {
            tracing::warn!(%error, "failed to start notification sound worker");
            mailbox.queue.lock().expect("initialized queue").shutdown = true;
        }
        Self { mailbox }
    }

    /// Enqueues an automatic sound with a guard for subsequent policy changes.
    pub fn play(&self, rule: NotificationSoundRule, allowed: NotificationSoundGuard) {
        if rule.volume == 0 {
            return;
        }
        let Ok(mut queue) = self.mailbox.queue.lock() else {
            return;
        };
        if queue.shutdown {
            return;
        }
        if queue.automatic.len() == MAX_QUEUED_SOUNDS {
            queue.automatic.pop_front();
        }
        queue.automatic.push_back(Request {
            rule,
            queued_at: Instant::now(),
            kind: RequestKind::Automatic(allowed),
        });
        self.mailbox.wake.notify_one();
    }

    /// Waits for the preview to be prepared and queued on the audio output.
    pub fn preview(&self, rule: NotificationSoundRule) -> Result<(), String> {
        let (reply, result) = mpsc::channel();
        {
            let mut queue = self
                .mailbox
                .queue
                .lock()
                .map_err(|_| worker_unavailable())?;
            if queue.shutdown {
                return Err(worker_unavailable());
            }
            queue.automatic.clear();
            if let Some(previous) = queue.preview.replace(Request {
                rule,
                queued_at: Instant::now(),
                kind: RequestKind::Preview(reply),
            }) {
                if let RequestKind::Preview(reply) = previous.kind {
                    let _ = reply.send(Err("Sound preview replaced by a newer preview".into()));
                }
            }
            self.mailbox.wake.notify_one();
        }
        result
            .recv_timeout(PREVIEW_TIMEOUT)
            .map_err(|error| format!("Sound preview did not start: {error}"))?
    }
}

impl Drop for NotificationSoundPlayer {
    fn drop(&mut self) {
        if let Ok(mut queue) = self.mailbox.queue.lock() {
            queue.shutdown = true;
            self.mailbox.wake.notify_one();
        }
    }
}

fn worker_unavailable() -> String {
    "Notification sound worker unavailable".into()
}

pub fn is_builtin_notification_sound(id: &str) -> bool {
    builtin_sound(id).is_some()
}

fn builtin_sound(id: &str) -> Option<&'static [u8]> {
    BUILTIN_SOUNDS
        .iter()
        .find_map(|(name, bytes)| (*name == id).then_some(*bytes))
}

/// Checks a custom file using the same decoder as playback.
pub fn validate_notification_sound_file(path: &str) -> Result<(), String> {
    decode_audio(Cow::Owned(read_custom_sound(path)?)).map(drop)
}

fn read_custom_sound(path: &str) -> Result<Vec<u8>, String> {
    let path = Path::new(path);
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if !["wav", "mp3", "ogg", "flac"]
        .iter()
        .any(|supported| extension.eq_ignore_ascii_case(supported))
    {
        return Err("Choose a WAV, MP3, OGG (Vorbis), or FLAC audio file".into());
    }
    let metadata = path
        .metadata()
        .map_err(|error| format!("Cannot open sound file: {error}"))?;
    if !metadata.is_file() {
        return Err("Choose a regular audio file".into());
    }
    if metadata.len() > MAX_FILE_BYTES {
        return Err("Choose an audio file of 16 MiB or less".into());
    }
    let file = File::open(path).map_err(|error| format!("Cannot open sound file: {error}"))?;
    let mut bytes = Vec::new();
    file.take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Cannot read sound file: {error}"))?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err("Choose an audio file of 16 MiB or less".into());
    }
    Ok(bytes)
}

fn sound_bytes(source: &NotificationSoundSource) -> Result<Cow<'static, [u8]>, String> {
    match source {
        NotificationSoundSource::Builtin { id } => builtin_sound(id)
            .map(Cow::Borrowed)
            .ok_or_else(|| "Unknown built-in notification sound".into()),
        NotificationSoundSource::Custom { path } => read_custom_sound(path).map(Cow::Owned),
    }
}

fn decode_audio(bytes: Cow<'static, [u8]>) -> Result<SamplesBuffer, String> {
    let mut decoder = Decoder::builder()
        .with_byte_len(bytes.len() as u64)
        .with_data(Cursor::new(bytes))
        .build()
        .map_err(|error| format!("Cannot decode sound file: {error}"))?;
    // The first Vorbis packet may contain zero frames. Prime the decoder so the
    // rate converter sees the first nonempty span and retain its first sample.
    let first = decoder
        .next()
        .ok_or_else(|| "The sound file contains no valid audio samples".to_string())?;
    let source = PrimedSource {
        first: Some(first),
        decoder,
    };
    let samples: Vec<f32> = UniformSourceIterator::new(source, CHANNELS, SAMPLE_RATE)
        .take(MAX_SAMPLES)
        .collect();
    if samples.is_empty() || samples.iter().any(|sample| !sample.is_finite()) {
        return Err("The sound file contains no valid audio samples".into());
    }
    Ok(SamplesBuffer::new(CHANNELS, SAMPLE_RATE, samples))
}

struct PrimedSource<S> {
    first: Option<f32>,
    decoder: S,
}

impl<S: Source> Iterator for PrimedSource<S> {
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        self.first.take().or_else(|| self.decoder.next())
    }
}

impl<S: Source> Source for PrimedSource<S> {
    fn current_span_len(&self) -> Option<usize> {
        self.decoder.current_span_len()
    }

    fn channels(&self) -> ChannelCount {
        self.decoder.channels()
    }

    fn sample_rate(&self) -> SampleRate {
        self.decoder.sample_rate()
    }

    fn total_duration(&self) -> Option<Duration> {
        self.decoder.total_duration()
    }
}

struct ActiveSound {
    player: Player,
    _device: MixerDeviceSink,
    allowed: Option<NotificationSoundGuard>,
    finished_at: Option<Instant>,
}

impl ActiveSound {
    fn is_active(&mut self) -> bool {
        if self.allowed.as_ref().is_some_and(|allowed| !allowed()) {
            return false;
        }
        !self.player.empty()
            || self.finished_at.get_or_insert_with(Instant::now).elapsed() < OUTPUT_DRAIN
    }
}

fn start_sound(request: &Request) -> Result<Option<ActiveSound>, String> {
    let source = decode_audio(sound_bytes(&request.rule.source)?)?;
    request.check_current()?;
    if request.rule.volume == 0 {
        return Ok(None);
    }
    let mut device = DeviceSinkBuilder::from_default_device()
        .and_then(|builder| builder.open_sink_or_fallback())
        .map_err(|error| format!("Cannot start audio output: {error}"))?;
    request.check_current()?;
    device.log_on_drop(false);
    let player = Player::connect_new(device.mixer());
    player.set_volume(f32::from(request.rule.volume.min(100)) / 100.0);
    player.append(source);
    let allowed = match &request.kind {
        RequestKind::Automatic(allowed) => Some(Arc::clone(allowed)),
        RequestKind::Preview(_) => None,
    };
    Ok(Some(ActiveSound {
        player,
        _device: device,
        allowed,
        finished_at: None,
    }))
}

fn run_worker(mailbox: Arc<Mailbox>) {
    let mut active: Option<ActiveSound> = None;
    loop {
        if active.as_mut().is_some_and(|sound| !sound.is_active()) {
            active = None;
        }
        let request = {
            let Ok(queue) = mailbox.queue.lock() else {
                return;
            };
            let pending = |queue: &mut SoundQueue| {
                !queue.shutdown
                    && queue.preview.is_none()
                    && (active.is_some() || queue.automatic.is_empty())
            };
            let queue = if active.is_some() {
                mailbox
                    .wake
                    .wait_timeout_while(queue, PLAYBACK_POLL, pending)
                    .ok()
                    .map(|(queue, _)| queue)
            } else {
                mailbox.wake.wait_while(queue, pending).ok()
            };
            let Some(mut queue) = queue else { return };
            if queue.shutdown {
                return;
            }
            queue.preview.take().or_else(|| {
                if active.is_none() {
                    queue.automatic.pop_front()
                } else {
                    None
                }
            })
        };
        let Some(request) = request else { continue };
        match &request.kind {
            RequestKind::Preview(reply) => {
                if let Err(error) = request.check_current() {
                    let _ = reply.send(Err(error));
                    continue;
                }
                active = None;
                match start_sound(&request) {
                    Ok(sound) => {
                        active = sound;
                        let _ = reply.send(Ok(()));
                    }
                    Err(error) => {
                        let _ = reply.send(Err(error));
                    }
                }
            }
            RequestKind::Automatic(_) if request.check_current().is_ok() => {
                match start_sound(&request) {
                    Ok(sound) => active = sound,
                    Err(error) if request.check_current().is_ok() => {
                        tracing::debug!(%error, "failed to play notification sound");
                    }
                    Err(_) => {}
                }
            }
            RequestKind::Automatic(_) => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_each_packaged_sound() {
        for (id, _) in BUILTIN_SOUNDS {
            let source = NotificationSoundSource::Builtin { id: (*id).into() };
            let decoded = decode_audio(sound_bytes(&source).unwrap()).unwrap();
            assert!(
                decoded.into_iter().any(|sample| sample.abs() > 0.01),
                "{id}"
            );
        }
    }

    #[test]
    fn rejects_unrecognized_and_corrupt_audio() {
        let source = NotificationSoundSource::Builtin {
            id: "missing".into(),
        };
        assert!(sound_bytes(&source).is_err());
        assert!(decode_audio(Cow::Borrowed(b"not audio")).is_err());
    }

    #[test]
    fn decodes_vorbis_with_an_empty_first_packet() {
        let ogg = include_bytes!("../tests/fixtures/notification-tone.ogg");
        let decoded = decode_audio(Cow::Borrowed(ogg)).unwrap();
        assert!(decoded.into_iter().any(|sample| sample.abs() > 0.01));
    }
}
