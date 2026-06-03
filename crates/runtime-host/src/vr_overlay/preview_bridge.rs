use std::{
    env, fs,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use serde::{Deserialize, Serialize};

use crate::RuntimeHostContext;

use super::{
    runtime::{build_wrist_frame_input, load_runtime_config},
    WristOverlayFrameInput,
};

const PREVIEW_ENABLED_ENV_KEY: &str = "VRCX0_OVERLAY_PREVIEW";
const PREVIEW_PATH_ENV_KEY: &str = "VRCX0_OVERLAY_PREVIEW_PATH";
const PREVIEW_DIR_NAME: &str = "vrcx0-overlay-preview";
const PREVIEW_FILE_NAME: &str = "wrist.json";
const PREVIEW_WRITE_INTERVAL: Duration = Duration::from_millis(250);

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WristOverlayPreviewSnapshot {
    pub version: u32,
    #[serde(flatten)]
    pub frame: WristOverlayFrameInput,
}

impl WristOverlayPreviewSnapshot {
    pub const VERSION: u32 = 1;

    pub fn from_frame_input(frame: WristOverlayFrameInput) -> Self {
        Self {
            version: Self::VERSION,
            frame,
        }
    }

    pub fn into_frame_input(self) -> WristOverlayFrameInput {
        self.frame
    }
}

pub fn default_preview_snapshot_path() -> PathBuf {
    env::var_os(PREVIEW_PATH_ENV_KEY)
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            env::temp_dir()
                .join(PREVIEW_DIR_NAME)
                .join(PREVIEW_FILE_NAME)
        })
}

pub fn start_preview_bridge_if_enabled(context: Arc<RuntimeHostContext>) {
    if !cfg!(debug_assertions) || !preview_bridge_enabled() {
        return;
    }

    let tasks = context.tasks.clone();
    tasks.spawn_cancellable_thread("vr-overlay-preview-bridge", move |stop_token| {
        let path = default_preview_snapshot_path();
        let mut last_json = Vec::new();
        while !stop_token.is_stop_requested() {
            match build_preview_snapshot(&context)
                .and_then(|snapshot| serde_json::to_vec_pretty(&snapshot).map_err(Into::into))
            {
                Ok(json) if json != last_json => {
                    if let Err(error) = write_atomic(&path, &json) {
                        tracing::warn!(
                            error = %error,
                            path = %path.display(),
                            "failed to write wrist overlay preview snapshot"
                        );
                    } else {
                        last_json = json;
                    }
                }
                Ok(_) => {}
                Err(error) => {
                    tracing::warn!(error = %error, "failed to build wrist overlay preview snapshot");
                }
            }
            std::thread::sleep(PREVIEW_WRITE_INTERVAL);
        }
    });
}

fn preview_bridge_enabled() -> bool {
    env::var(PREVIEW_ENABLED_ENV_KEY)
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}

fn build_preview_snapshot(
    context: &RuntimeHostContext,
) -> Result<WristOverlayPreviewSnapshot, Box<dyn std::error::Error + Send + Sync>> {
    let config = load_runtime_config(context.config());
    let input = build_wrist_frame_input(context, config, Vec::new());
    Ok(WristOverlayPreviewSnapshot::from_frame_input(input))
}

fn write_atomic(path: &Path, json: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temp_path = path.with_extension(format!("json.tmp.{}", std::process::id()));
    fs::write(&temp_path, json)?;
    if fs::rename(&temp_path, path).is_err() {
        let _ = fs::remove_file(path);
        fs::rename(&temp_path, path)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_snapshot_round_trips_frame_input() {
        let input = WristOverlayFrameInput {
            activity: Default::default(),
            devices: Vec::new(),
            footer: Default::default(),
            options: Default::default(),
            locale: "zh-CN".to_string(),
            captured_at_ms: 42,
        };
        let snapshot = WristOverlayPreviewSnapshot::from_frame_input(input.clone());
        assert_eq!(snapshot.version, WristOverlayPreviewSnapshot::VERSION);
        assert_eq!(snapshot.into_frame_input().locale, input.locale);
    }
}
