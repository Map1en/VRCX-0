use sysinfo::{MemoryRefreshKind, System};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SystemUsage {
    pub cpu_percent: f32,
    pub memory_used_bytes: u64,
    pub memory_total_bytes: u64,
}

#[derive(Default)]
pub struct SystemUsageSampler {
    system: Option<System>,
}

impl SystemUsageSampler {
    pub fn sample(&mut self) -> Option<SystemUsage> {
        if self.system.is_none() {
            self.system = System::new().ok();
        }
        let system = self.system.as_mut()?;
        system.refresh_cpu_usage();
        system.refresh_memory_specifics(MemoryRefreshKind::nothing().with_ram());
        Some(SystemUsage {
            cpu_percent: system.global_cpu_usage(),
            memory_used_bytes: system.used_memory(),
            memory_total_bytes: system.total_memory(),
        })
    }
}
