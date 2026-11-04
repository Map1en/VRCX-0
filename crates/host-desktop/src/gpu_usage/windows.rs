use std::collections::HashMap;

use windows::core::{w, PCWSTR};
use windows::Wdk::Graphics::Direct3D::{
    D3DKMTCloseAdapter, D3DKMTOpenAdapterFromLuid, D3DKMTQueryAdapterInfo, D3DKMT_ADAPTER_PERFDATA,
    D3DKMT_CLOSEADAPTER, D3DKMT_OPENADAPTERFROMLUID, D3DKMT_QUERYADAPTERINFO,
    KMTQAITYPE_ADAPTERPERFDATA,
};
use windows::Win32::Foundation::LUID;
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory1, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE,
};
use windows::Win32::System::Performance::{
    PdhAddEnglishCounterW, PdhCloseQuery, PdhCollectQueryData, PdhGetFormattedCounterArrayW,
    PdhOpenQueryW, PDH_CSTATUS_NEW_DATA, PDH_CSTATUS_VALID_DATA, PDH_FMT,
    PDH_FMT_COUNTERVALUE_ITEM_W, PDH_FMT_DOUBLE, PDH_HCOUNTER, PDH_HQUERY, PDH_MORE_DATA,
};

use super::GpuUsage;

const PDH_FMT_NOCAP100: u32 = 0x8000;

pub(super) struct Sampler {
    instance: String,
    vram_total_bytes: u64,
    query: PDH_HQUERY,
    engines: PDH_HCOUNTER,
    memory: PDH_HCOUNTER,
    adapter: Option<u32>,
}

// SAFETY: the PDH query and counter handles are only used through `&mut self`, and PDH allows a
// query to be collected from any thread as long as calls are not concurrent.
unsafe impl Send for Sampler {}

impl Sampler {
    pub(super) fn open() -> Option<Self> {
        let adapters = hardware_adapters();
        let mut query = PDH_HQUERY::default();
        if adapters.is_empty() || unsafe { PdhOpenQueryW(PCWSTR::null(), 0, &mut query) } != 0 {
            return None;
        }
        let mut sampler = Self {
            instance: String::new(),
            vram_total_bytes: 0,
            query,
            engines: PDH_HCOUNTER::default(),
            memory: PDH_HCOUNTER::default(),
            adapter: None,
        };
        unsafe {
            PdhAddEnglishCounterW(
                query,
                w!("\\GPU Engine(*)\\Utilization Percentage"),
                0,
                &mut sampler.engines,
            );
            PdhAddEnglishCounterW(
                query,
                w!("\\GPU Adapter Memory(*)\\Dedicated Usage"),
                0,
                &mut sampler.memory,
            );
            PdhCollectQueryData(query);
        }
        let counted = counter_values(sampler.memory);
        let (luid, vram_total_bytes) = adapters
            .iter()
            .find(|(luid, _)| {
                counted
                    .iter()
                    .any(|(name, _)| *name == instance_name(*luid))
            })
            .unwrap_or(&adapters[0]);
        sampler.instance = instance_name(*luid);
        sampler.vram_total_bytes = *vram_total_bytes;
        sampler.adapter = open_adapter(*luid);
        Some(sampler)
    }

    pub(super) fn sample(&mut self) -> GpuUsage {
        let collected = unsafe { PdhCollectQueryData(self.query) } == 0;
        GpuUsage {
            usage_percent: collected.then(|| self.engine_usage()).flatten(),
            vram_used_bytes: collected.then(|| self.vram_used()).flatten(),
            vram_total_bytes: (self.vram_total_bytes > 0).then_some(self.vram_total_bytes),
            temperature_celsius: self.adapter.and_then(temperature),
        }
    }

    fn engine_usage(&self) -> Option<f32> {
        let mut engines = HashMap::<String, f64>::new();
        for (name, value) in counter_values(self.engines) {
            if let Some(engine) = name
                .find("luid_")
                .map(|start| &name[start..])
                .filter(|engine| engine.starts_with(&self.instance))
            {
                *engines.entry(engine.to_string()).or_default() += value;
            }
        }
        engines
            .into_values()
            .reduce(f64::max)
            .map(|percent| percent.clamp(0.0, 100.0) as f32)
    }

    fn vram_used(&self) -> Option<u64> {
        counter_values(self.memory)
            .into_iter()
            .find(|(name, _)| *name == self.instance)
            .map(|(_, bytes)| bytes.max(0.0) as u64)
    }
}

impl Drop for Sampler {
    fn drop(&mut self) {
        unsafe {
            PdhCloseQuery(self.query);
            if let Some(adapter) = self.adapter {
                let _ = D3DKMTCloseAdapter(&D3DKMT_CLOSEADAPTER { hAdapter: adapter });
            }
        }
    }
}

fn instance_name(luid: LUID) -> String {
    format!(
        "luid_0x{:08x}_0x{:08x}_phys_0",
        luid.HighPart as u32, luid.LowPart
    )
}

fn hardware_adapters() -> Vec<(LUID, u64)> {
    let Ok(factory) = (unsafe { CreateDXGIFactory1::<IDXGIFactory1>() }) else {
        return Vec::new();
    };
    let mut adapters: Vec<(LUID, u64)> = (0..)
        .map_while(|index| unsafe { factory.EnumAdapters1(index) }.ok())
        .filter_map(|adapter| unsafe { adapter.GetDesc1() }.ok())
        .filter(|desc| desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 == 0)
        .map(|desc| (desc.AdapterLuid, desc.DedicatedVideoMemory as u64))
        .collect();
    adapters.sort_by_key(|(_, dedicated)| std::cmp::Reverse(*dedicated));
    adapters
}

fn open_adapter(luid: LUID) -> Option<u32> {
    let mut open = D3DKMT_OPENADAPTERFROMLUID {
        AdapterLuid: luid,
        hAdapter: 0,
    };
    unsafe { D3DKMTOpenAdapterFromLuid(&mut open) }
        .is_ok()
        .then_some(open.hAdapter)
}

fn temperature(adapter: u32) -> Option<f32> {
    let mut perf = D3DKMT_ADAPTER_PERFDATA::default();
    let mut query = D3DKMT_QUERYADAPTERINFO {
        hAdapter: adapter,
        Type: KMTQAITYPE_ADAPTERPERFDATA,
        pPrivateDriverData: (&raw mut perf).cast(),
        PrivateDriverDataSize: size_of::<D3DKMT_ADAPTER_PERFDATA>() as u32,
    };
    let ok = unsafe { D3DKMTQueryAdapterInfo(&mut query) }.is_ok();
    (ok && perf.Temperature > 0).then(|| perf.Temperature as f32 / 10.0)
}

fn counter_values(counter: PDH_HCOUNTER) -> Vec<(String, f64)> {
    if counter.is_invalid() {
        return Vec::new();
    }
    let format = PDH_FMT(PDH_FMT_DOUBLE.0 | PDH_FMT_NOCAP100);
    let mut size = 0u32;
    let mut count = 0u32;
    let status =
        unsafe { PdhGetFormattedCounterArrayW(counter, format, &mut size, &mut count, None) };
    if status != PDH_MORE_DATA || size == 0 {
        return Vec::new();
    }
    let mut buffer = vec![0u64; (size as usize).div_ceil(size_of::<u64>())];
    let items = buffer.as_mut_ptr().cast::<PDH_FMT_COUNTERVALUE_ITEM_W>();
    let status = unsafe {
        PdhGetFormattedCounterArrayW(counter, format, &mut size, &mut count, Some(items))
    };
    if status != 0 {
        return Vec::new();
    }
    let items = unsafe { std::slice::from_raw_parts(items, count as usize) };
    items
        .iter()
        .filter(|item| {
            matches!(
                item.FmtValue.CStatus,
                PDH_CSTATUS_VALID_DATA | PDH_CSTATUS_NEW_DATA
            )
        })
        .filter_map(|item| {
            let name = unsafe { item.szName.to_string() }.ok()?;
            Some((name.to_ascii_lowercase(), unsafe {
                item.FmtValue.Anonymous.doubleValue
            }))
        })
        .collect()
}
