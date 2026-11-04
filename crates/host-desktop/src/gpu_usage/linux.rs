use std::fs;
use std::path::{Path, PathBuf};

use super::GpuUsage;

const DRM_ROOT: &str = "/sys/class/drm";

pub(super) struct Sampler {
    device: PathBuf,
    temperature: Option<PathBuf>,
}

impl Sampler {
    pub(super) fn open() -> Option<Self> {
        let device = fs::read_dir(DRM_ROOT)
            .ok()?
            .flatten()
            .filter(|entry| is_card_name(&entry.file_name().to_string_lossy()))
            .map(|entry| entry.path().join("device"))
            .filter_map(|device| {
                read_u64(&device.join("mem_info_vram_total")).map(|total| (device, total))
            })
            .max_by_key(|(_, total)| *total)
            .map(|(device, _)| device)?;
        let temperature = fs::read_dir(device.join("hwmon"))
            .ok()
            .into_iter()
            .flatten()
            .flatten()
            .map(|entry| entry.path().join("temp1_input"))
            .find(|path| path.exists());
        Some(Self {
            device,
            temperature,
        })
    }

    pub(super) fn sample(&mut self) -> GpuUsage {
        GpuUsage {
            usage_percent: read_u64(&self.device.join("gpu_busy_percent"))
                .map(|percent| percent.min(100) as f32),
            vram_used_bytes: read_u64(&self.device.join("mem_info_vram_used")),
            vram_total_bytes: read_u64(&self.device.join("mem_info_vram_total")),
            temperature_celsius: self
                .temperature
                .as_deref()
                .and_then(read_u64)
                .filter(|millidegrees| *millidegrees > 0)
                .map(|millidegrees| millidegrees as f32 / 1000.0),
        }
    }
}

fn is_card_name(name: &str) -> bool {
    name.strip_prefix("card")
        .is_some_and(|index| !index.is_empty() && index.bytes().all(|byte| byte.is_ascii_digit()))
}

fn read_u64(path: &Path) -> Option<u64> {
    fs::read_to_string(path).ok()?.trim().parse().ok()
}
