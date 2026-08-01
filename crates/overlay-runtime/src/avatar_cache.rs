use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};

use vrcx_0_application_core::WebClient;
use vrcx_0_vr_overlay::AvatarBitmap;

const HMD_AVATAR_SIZE: u32 = 128;
const HMD_AVATAR_MASK_FEATHER_PX: f32 = 2.0;
const HMD_AVATAR_FETCH_TIMEOUT: Duration = Duration::from_secs(5);
const HMD_AVATAR_FAILURE_TTL: Duration = Duration::from_secs(60);
const HMD_AVATAR_CACHE_CAPACITY: usize = 300;

#[derive(Default)]
struct AvatarBitmapCacheState {
    entries: HashMap<String, AvatarBitmapCacheEntry>,
    next_seq: u64,
}

#[derive(Clone)]
struct AvatarBitmapCacheEntry {
    bitmap: AvatarBitmap,
    user_id: String,
    last_used_seq: u64,
}

impl AvatarBitmapCacheState {
    fn next_lru_seq(&mut self) -> u64 {
        self.next_seq = self.next_seq.saturating_add(1);
        self.next_seq
    }

    fn evict_oldest_if_over_capacity(&mut self) {
        while self.entries.len() > HMD_AVATAR_CACHE_CAPACITY {
            let Some(oldest_url) = self
                .entries
                .iter()
                .min_by_key(|(_, entry)| entry.last_used_seq)
                .map(|(url, _)| url.clone())
            else {
                break;
            };
            self.entries.remove(&oldest_url);
        }
    }
}

#[derive(Default)]
pub(super) struct AvatarBitmapCache {
    success: Mutex<AvatarBitmapCacheState>,
    failures: Mutex<HashMap<String, Instant>>,
    inflight: Mutex<HashMap<String, std::sync::Weak<tokio::sync::Mutex<()>>>>,
    generation: AtomicU64,
}

impl AvatarBitmapCache {
    pub(super) fn new() -> Self {
        Self::default()
    }

    pub(super) async fn resolve(
        &self,
        web: &WebClient,
        url: &str,
        user_id: &str,
    ) -> Option<AvatarBitmap> {
        let url = url.trim();
        let user_id = user_id.trim();
        if url.is_empty() || !user_id.starts_with("usr_") {
            return None;
        }
        let generation = self.generation();
        if let Some(bitmap) = self.cached(url, user_id) {
            return Some(bitmap);
        }
        if self.recently_failed(url) {
            return None;
        }
        let inflight = self.inflight_lock(url);
        let _guard = inflight.lock().await;
        if let Some(bitmap) = self.cached(url, user_id) {
            return Some(bitmap);
        }
        if self.recently_failed(url) {
            return None;
        }
        let bitmap = self.fetch_and_decode(web, url).await;
        match bitmap {
            Some(bitmap) => {
                if self.store_success_if_generation(url, user_id, bitmap.clone(), generation) {
                    Some(bitmap)
                } else {
                    None
                }
            }
            None => {
                self.store_failure_if_generation(url, generation);
                None
            }
        }
    }

    async fn fetch_and_decode(&self, web: &WebClient, url: &str) -> Option<AvatarBitmap> {
        let fetcher = web.image_fetcher().ok()?;
        let bytes = tokio::time::timeout(HMD_AVATAR_FETCH_TIMEOUT, fetcher.fetch_image(url))
            .await
            .ok()?
            .ok()?;
        decode_avatar_bitmap(&bytes)
    }

    pub(super) fn cached(&self, url: &str, user_id: &str) -> Option<AvatarBitmap> {
        let url = url.trim();
        let user_id = user_id.trim();
        if url.is_empty() || user_id.is_empty() {
            return None;
        }
        let mut success = self
            .success
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if success
            .entries
            .get(url)
            .is_none_or(|entry| entry.user_id != user_id)
        {
            return None;
        }
        let last_used_seq = success.next_lru_seq();
        let entry = success.entries.get_mut(url)?;
        entry.last_used_seq = last_used_seq;
        Some(entry.bitmap.clone())
    }

    fn recently_failed(&self, url: &str) -> bool {
        self.failures
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .get(url)
            .is_some_and(|at| at.elapsed() < HMD_AVATAR_FAILURE_TTL)
    }

    #[cfg(test)]
    pub(super) fn store_success(&self, url: &str, user_id: &str, bitmap: AvatarBitmap) {
        let generation = self.generation();
        let _ = self.store_success_if_generation(url, user_id, bitmap, generation);
    }

    fn store_success_if_generation(
        &self,
        url: &str,
        user_id: &str,
        bitmap: AvatarBitmap,
        generation: u64,
    ) -> bool {
        let url = url.trim();
        let user_id = user_id.trim();
        if url.is_empty() || !user_id.starts_with("usr_") || !self.is_generation_current(generation)
        {
            return false;
        }
        let mut success = self
            .success
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if !self.is_generation_current(generation) {
            return false;
        }
        let last_used_seq = success.next_lru_seq();
        success.entries.insert(
            url.to_string(),
            AvatarBitmapCacheEntry {
                bitmap,
                user_id: user_id.to_string(),
                last_used_seq,
            },
        );
        success.evict_oldest_if_over_capacity();
        true
    }

    #[cfg(test)]
    fn store_failure(&self, url: &str) {
        let generation = self.generation();
        let _ = self.store_failure_if_generation(url, generation);
    }

    fn store_failure_if_generation(&self, url: &str, generation: u64) -> bool {
        if !self.is_generation_current(generation) {
            return false;
        }
        let mut failures = self
            .failures
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if !self.is_generation_current(generation) {
            return false;
        }
        failures.retain(|_, at| at.elapsed() < HMD_AVATAR_FAILURE_TTL);
        failures.insert(url.to_string(), Instant::now());
        true
    }

    fn inflight_lock(&self, url: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut inflight = self
            .inflight
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if let Some(existing) = inflight.get(url).and_then(std::sync::Weak::upgrade) {
            return existing;
        }
        inflight.retain(|_, weak| weak.strong_count() > 0);
        let guard = Arc::new(tokio::sync::Mutex::new(()));
        inflight.insert(url.to_string(), Arc::downgrade(&guard));
        guard
    }

    pub(super) fn clear(&self) {
        self.generation.fetch_add(1, Ordering::AcqRel);
        *self
            .success
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = AvatarBitmapCacheState::default();
        self.failures
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clear();
        self.inflight
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clear();
    }

    pub(super) fn generation(&self) -> u64 {
        self.generation.load(Ordering::Acquire)
    }

    pub(super) fn is_generation_current(&self, generation: u64) -> bool {
        self.generation.load(Ordering::Acquire) == generation
    }
}

fn decode_avatar_bitmap(bytes: &[u8]) -> Option<AvatarBitmap> {
    let decoded = image::load_from_memory(bytes).ok()?;
    let image = if decoded.width() == HMD_AVATAR_SIZE && decoded.height() == HMD_AVATAR_SIZE {
        decoded.to_rgba8()
    } else {
        decoded
            .resize_to_fill(
                HMD_AVATAR_SIZE,
                HMD_AVATAR_SIZE,
                image::imageops::FilterType::Lanczos3,
            )
            .to_rgba8()
    };
    let mut rgba = image.into_raw();
    apply_circular_avatar_mask(&mut rgba, HMD_AVATAR_SIZE, HMD_AVATAR_SIZE);
    Some(AvatarBitmap {
        width: HMD_AVATAR_SIZE,
        height: HMD_AVATAR_SIZE,
        rgba: Arc::<[u8]>::from(rgba),
    })
}

fn apply_circular_avatar_mask(rgba: &mut [u8], width: u32, height: u32) {
    let center_x = (width as f32 - 1.0) / 2.0;
    let center_y = (height as f32 - 1.0) / 2.0;
    let radius = width.min(height) as f32 / 2.0;
    let half_feather = HMD_AVATAR_MASK_FEATHER_PX / 2.0;
    for y in 0..height {
        for x in 0..width {
            let dx = x as f32 - center_x;
            let dy = y as f32 - center_y;
            let distance = (dx * dx + dy * dy).sqrt();
            let coverage =
                ((radius - distance + half_feather) / HMD_AVATAR_MASK_FEATHER_PX).clamp(0.0, 1.0);
            let alpha_index = ((y * width + x) * 4 + 3) as usize;
            if let Some(alpha) = rgba.get_mut(alpha_index) {
                *alpha = ((*alpha as f32) * coverage).round() as u8;
            }
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn circular_avatar_mask_makes_corners_transparent() {
        assert_eq!(HMD_AVATAR_SIZE, 128);
        let mut rgba = vec![255; (HMD_AVATAR_SIZE * HMD_AVATAR_SIZE * 4) as usize];
        apply_circular_avatar_mask(&mut rgba, HMD_AVATAR_SIZE, HMD_AVATAR_SIZE);
        let alpha_at = |x: u32, y: u32| rgba[((y * HMD_AVATAR_SIZE + x) * 4 + 3) as usize];

        assert_eq!(alpha_at(0, 0), 0);
        assert_eq!(alpha_at(HMD_AVATAR_SIZE / 2, HMD_AVATAR_SIZE / 2), 255);
        let edge_alpha = alpha_at(HMD_AVATAR_SIZE - 1, HMD_AVATAR_SIZE / 2);
        assert!(edge_alpha > 0);
        assert!(edge_alpha < 255);
    }

    #[test]
    fn decode_avatar_bitmap_returns_128_square_for_square_source() {
        let bytes = test_png(128, 128);
        let avatar = decode_avatar_bitmap(&bytes).expect("decode avatar bitmap");

        assert_eq!(avatar.width, 128);
        assert_eq!(avatar.height, 128);
    }

    #[test]
    fn decode_avatar_bitmap_resizes_non_square_source_to_128_square() {
        let bytes = test_png(256, 128);
        let avatar = decode_avatar_bitmap(&bytes).expect("decode avatar bitmap");

        assert_eq!(avatar.width, 128);
        assert_eq!(avatar.height, 128);
    }

    #[test]
    fn avatar_bitmap_cache_keeps_friend_bitmap_until_lifecycle_clear() {
        let cache = AvatarBitmapCache::new();
        cache.store_success(
            "https://images.example/avatar",
            "usr_friend",
            test_avatar_bitmap(),
        );

        assert!(cache
            .cached("https://images.example/avatar", "usr_friend")
            .is_some());

        cache.clear();

        assert!(cache
            .cached("https://images.example/avatar", "usr_friend")
            .is_none());
    }

    #[test]
    fn avatar_bitmap_cache_rejects_other_user_context() {
        let cache = AvatarBitmapCache::new();
        cache.store_success(
            "https://images.example/avatar",
            "usr_friend",
            test_avatar_bitmap(),
        );

        assert!(cache
            .cached("https://images.example/avatar", "usr_stranger")
            .is_none());
    }

    #[test]
    fn avatar_bitmap_cache_evicts_least_recently_used_entry_after_capacity() {
        let cache = AvatarBitmapCache::new();
        for index in 0..HMD_AVATAR_CACHE_CAPACITY {
            let url = format!("https://images.example/avatar/{index}");
            let user_id = format!("usr_friend_{index}");
            cache.store_success(&url, &user_id, test_avatar_bitmap());
        }

        assert!(cache
            .cached("https://images.example/avatar/0", "usr_friend_0")
            .is_some());
        cache.store_success(
            "https://images.example/avatar/new",
            "usr_friend_new",
            test_avatar_bitmap(),
        );

        assert!(cache
            .cached("https://images.example/avatar/0", "usr_friend_0")
            .is_some());
        assert!(cache
            .cached("https://images.example/avatar/1", "usr_friend_1")
            .is_none());
        assert!(cache
            .cached("https://images.example/avatar/new", "usr_friend_new")
            .is_some());
    }

    #[test]
    fn avatar_bitmap_cache_failure_ttl_still_suppresses_short_term_retries() {
        let cache = AvatarBitmapCache::new();
        cache.store_failure("https://images.example/avatar");

        assert!(cache.recently_failed("https://images.example/avatar"));

        *cache
            .failures
            .lock()
            .unwrap()
            .get_mut("https://images.example/avatar")
            .unwrap() = Instant::now() - HMD_AVATAR_FAILURE_TTL - Duration::from_secs(1);

        assert!(!cache.recently_failed("https://images.example/avatar"));
    }

    #[test]
    fn avatar_bitmap_cache_rejects_stale_fetch_results_after_clear() {
        let cache = AvatarBitmapCache::new();
        let generation = cache.generation();

        cache.clear();

        assert!(!cache.store_success_if_generation(
            "https://images.example/avatar",
            "usr_friend",
            test_avatar_bitmap(),
            generation,
        ));
        assert!(cache
            .cached("https://images.example/avatar", "usr_friend")
            .is_none());
        assert!(!cache.store_failure_if_generation("https://images.example/avatar", generation));
        assert!(!cache.recently_failed("https://images.example/avatar"));
    }

    fn test_png(width: u32, height: u32) -> Vec<u8> {
        let image = image::RgbaImage::from_pixel(width, height, image::Rgba([255, 0, 0, 255]));
        let mut bytes = Cursor::new(Vec::new());
        image
            .write_to(&mut bytes, image::ImageFormat::Png)
            .expect("encode test png");
        bytes.into_inner()
    }

    pub(crate) fn test_avatar_bitmap() -> AvatarBitmap {
        AvatarBitmap {
            width: 1,
            height: 1,
            rgba: Arc::<[u8]>::from([255, 255, 255, 255]),
        }
    }

    #[cfg(feature = "friends-panel")]
    pub(crate) fn test_avatar_bitmap_with_red(red: u8) -> AvatarBitmap {
        AvatarBitmap {
            width: 1,
            height: 1,
            rgba: Arc::<[u8]>::from([red, 0, 0, 255]),
        }
    }
}
