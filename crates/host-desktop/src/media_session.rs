#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MediaSessionInfo {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub position_seconds: Option<u64>,
    pub duration_seconds: Option<u64>,
}

#[cfg(windows)]
pub fn current_media_session() -> Option<MediaSessionInfo> {
    let _apartment = MtaApartment::enter();
    windows_impl::read().ok().flatten()
}

#[cfg(not(windows))]
pub fn current_media_session() -> Option<MediaSessionInfo> {
    None
}

#[cfg(windows)]
struct MtaApartment {
    uninitialize: bool,
}

#[cfg(windows)]
impl MtaApartment {
    fn enter() -> Self {
        use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

        let status = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        Self {
            uninitialize: status.is_ok(),
        }
    }
}

#[cfg(windows)]
impl Drop for MtaApartment {
    fn drop(&mut self) {
        if self.uninitialize {
            unsafe { windows::Win32::System::Com::CoUninitialize() };
        }
    }
}

#[cfg(windows)]
mod windows_impl {
    use std::time::{SystemTime, UNIX_EPOCH};

    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSessionManager as SessionManager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
    };

    use super::MediaSessionInfo;

    const TICKS_PER_SECOND: i64 = 10_000_000;
    const UNIX_EPOCH_AS_FILETIME_SECONDS: i64 = 11_644_473_600;

    pub(super) fn read() -> windows::core::Result<Option<MediaSessionInfo>> {
        let manager = SessionManager::RequestAsync()?.join()?;
        let Ok(session) = manager.GetCurrentSession() else {
            return Ok(None);
        };
        if session.GetPlaybackInfo()?.PlaybackStatus()? != PlaybackStatus::Playing {
            return Ok(None);
        }
        let properties = session.TryGetMediaPropertiesAsync()?.join()?;
        let title = properties.Title()?.to_string_lossy();
        if title.trim().is_empty() {
            return Ok(None);
        }
        let artist = properties
            .Artist()
            .map(|artist| artist.to_string_lossy())
            .unwrap_or_default();
        let album = properties
            .AlbumTitle()
            .map(|album| album.to_string_lossy())
            .unwrap_or_default();
        let (position_seconds, duration_seconds) = session
            .GetTimelineProperties()
            .ok()
            .and_then(|timeline| {
                let start = timeline.StartTime().ok()?.Duration;
                let end = timeline.EndTime().ok()?.Duration;
                let position = timeline.Position().ok()?.Duration;
                let updated = timeline.LastUpdatedTime().ok()?.UniversalTime;
                let duration = end - start;
                if duration <= 0 {
                    return None;
                }
                let drift = now_filetime_ticks()
                    .map(|now| (now - updated).max(0))
                    .unwrap_or(0);
                let position = (position - start + drift).clamp(0, duration);
                Some((
                    Some((position / TICKS_PER_SECOND) as u64),
                    Some((duration / TICKS_PER_SECOND) as u64),
                ))
            })
            .unwrap_or((None, None));
        Ok(Some(MediaSessionInfo {
            title,
            artist,
            album,
            position_seconds,
            duration_seconds,
        }))
    }

    fn now_filetime_ticks() -> Option<i64> {
        let since_unix = SystemTime::now().duration_since(UNIX_EPOCH).ok()?;
        let seconds = i64::try_from(since_unix.as_secs()).ok()? + UNIX_EPOCH_AS_FILETIME_SECONDS;
        Some(seconds * TICKS_PER_SECOND + i64::from(since_unix.subsec_nanos() / 100))
    }
}
