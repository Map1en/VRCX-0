#[cfg(target_os = "linux")]
#[path = "gpu_usage/linux.rs"]
mod platform;
#[cfg(windows)]
#[path = "gpu_usage/windows.rs"]
mod platform;

#[cfg(any(windows, target_os = "linux"))]
use std::time::{Duration, Instant};

#[cfg(any(windows, target_os = "linux"))]
const REOPEN_INTERVAL: Duration = Duration::from_secs(30);

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct GpuUsage {
    pub usage_percent: Option<f32>,
    pub vram_used_bytes: Option<u64>,
    pub vram_total_bytes: Option<u64>,
    pub temperature_celsius: Option<f32>,
}

#[derive(Default)]
pub struct GpuUsageSampler {
    #[cfg(any(windows, target_os = "linux"))]
    sampler: Option<platform::Sampler>,
    #[cfg(any(windows, target_os = "linux"))]
    opened_at: Option<Instant>,
    #[cfg(any(windows, target_os = "linux"))]
    read_vram: bool,
}

impl GpuUsageSampler {
    #[cfg(any(windows, target_os = "linux"))]
    pub fn sample(&mut self) -> Option<GpuUsage> {
        let usage = self.sampler.as_mut().map(platform::Sampler::sample);
        let lost = match usage {
            Some(usage) if usage.vram_used_bytes.is_some() => {
                self.read_vram = true;
                false
            }
            Some(_) => self.read_vram,
            None => true,
        };
        let waited = self
            .opened_at
            .is_none_or(|opened_at| opened_at.elapsed() >= REOPEN_INTERVAL);
        if !(lost && waited) {
            return usage;
        }
        self.opened_at = Some(Instant::now());
        self.read_vram = false;
        self.sampler = platform::Sampler::open();
        self.sampler.as_mut().map(platform::Sampler::sample)
    }

    #[cfg(not(any(windows, target_os = "linux")))]
    pub fn sample(&mut self) -> Option<GpuUsage> {
        None
    }
}
