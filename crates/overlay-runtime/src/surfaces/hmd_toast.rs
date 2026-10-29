use std::collections::VecDeque;
use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::Utc;
use vrcx_0_application_activity::notification::unresolved_group_id;
use vrcx_0_application_activity::{
    ActivityActorRelation, ActivityCategory, ActivityContent, ActivityDelivery, ActivityEntry,
    ActivityText,
};
use vrcx_0_contracts::activity::ActivityKind;
use vrcx_0_core::location::{is_meaningful_world_name, parse_location, world_id_from_location};
use vrcx_0_i18n::OverlayMessage;
use vrcx_0_vr_overlay::{AvatarBitmap, OverlaySurfaceId, RgbaFrame, MAIN_SURFACE_ID};

use super::super::manager::VrOverlayManager;
use super::super::runtime::{
    render_slint_hmd_frame, HmdNotificationStyle, VrOverlayRuntime, VrOverlayRuntimeConfig,
};
use super::super::service::HostVrOverlayService;
use super::super::test_preview::test_hmd_toast_views;
use super::super::tracker_watch::TrackerDisconnect;
use super::super::VrOverlayRuntimeServices;
use super::main::{build_main_surface_model, HmdToastView, MainOverlayFrameInput};

const HMD_TOAST_CAPACITY: usize = 3;
const HMD_TOAST_LOCATION_RESOLVE_BUDGET: Duration = Duration::from_secs(2);
const HMD_JOIN_LEAVE_MERGE_WINDOW: Duration = Duration::from_secs(4);

#[derive(Clone)]
pub(crate) struct HmdToastState {
    entry: ActivityEntry,
    expires_at: Instant,
    last_updated_at: Instant,
    avatar: Option<AvatarBitmap>,
    merge_count: u32,
}

impl VrOverlayRuntime {
    pub(crate) fn ingest_hmd_delivery(self: &Arc<Self>, delivery: ActivityDelivery) {
        if !delivery.hmd
            || !self.hmd_notifications_allowed()
            || !self.is_hmd_surface_active(self.current_runtime_config())
        {
            return;
        }
        let entry = delivery.entry;
        if entry.kind == ActivityKind::OnPlayerJoining {
            self.deliver_hmd_toast(entry);
            return;
        }
        let world_id = unresolved_entry_world_id(&entry);
        let group_id = unresolved_group_id(&entry.content);
        let services = self.services.as_ref().cloned();
        let Some(services) = services.filter(|_| world_id.is_some() || group_id.is_some()) else {
            self.deliver_hmd_toast(entry);
            return;
        };
        let runtime = Arc::clone(self);
        let tasks = services.tasks().clone();
        tasks.spawn(async move {
            let mut entry = entry;
            let endpoint = services.auth_scope().snapshot().endpoint;
            if !endpoint.trim().is_empty() {
                let world_name = async {
                    let world_id = world_id.as_deref()?;
                    let resolve = services.world_cache().resolve_name(
                        services.web_client().as_ref(),
                        &endpoint,
                        world_id,
                    );
                    tokio::time::timeout(HMD_TOAST_LOCATION_RESOLVE_BUDGET, resolve)
                        .await
                        .ok()
                        .flatten()
                };
                let group_name = async {
                    let group_id = group_id.as_deref()?;
                    let resolve = services.notification_group_name(&endpoint, group_id);
                    tokio::time::timeout(HMD_TOAST_LOCATION_RESOLVE_BUDGET, resolve)
                        .await
                        .ok()
                        .flatten()
                };
                let (world_name, group_name) = tokio::join!(world_name, group_name);
                if let Some(world_name) = world_name {
                    entry.content.world_name = world_name;
                }
                if let Some(group_name) = group_name {
                    entry.content.group_name = group_name;
                }
            }
            runtime.deliver_hmd_toast(entry);
        });
    }

    fn deliver_hmd_toast(self: &Arc<Self>, entry: ActivityEntry) {
        let config = self.current_runtime_config();
        if !self.hmd_notifications_allowed() || !self.is_hmd_surface_active(config) {
            return;
        }
        let timeout = Duration::from_millis(config.hmd.timeout_ms);
        if !self.enqueue_hmd_toast(entry.clone(), Instant::now(), timeout) {
            return;
        }
        self.reconcile_current();
        self.spawn_avatar_fetch(&entry);
    }

    pub(crate) fn deliver_tracker_disconnect_toast(&self, disconnect: TrackerDisconnect) {
        let config = self.current_runtime_config();
        if !config.hmd.tracker_disconnect
            || !self.hmd_notifications_allowed()
            || !self.is_hmd_surface_active(config)
        {
            return;
        }
        let timeout = Duration::from_millis(config.hmd.timeout_ms);
        if self.enqueue_hmd_toast(
            tracker_disconnect_entry(disconnect),
            Instant::now(),
            timeout,
        ) {
            self.reconcile_current();
        }
    }

    fn enqueue_hmd_toast(&self, entry: ActivityEntry, now: Instant, timeout: Duration) -> bool {
        let Ok(mut queue) = self.hmd_toasts.lock() else {
            return false;
        };
        let last_toast_expired = prune_expired_hmd_toasts(&mut queue, now);
        if let Some(index) = queue
            .iter_mut()
            .rposition(|toast| should_merge_hmd_toast(toast, &entry, now))
        {
            let mut existing = queue
                .remove(index)
                .expect("matched HMD toast index remains present");
            existing.entry = entry;
            existing.merge_count = existing.merge_count.saturating_add(1);
            existing.expires_at = now + timeout;
            existing.last_updated_at = now;
            queue.push_back(existing);
        } else {
            while queue.len() >= HMD_TOAST_CAPACITY {
                queue.pop_front();
            }
            queue.push_back(HmdToastState {
                entry,
                expires_at: now + timeout,
                last_updated_at: now,
                avatar: None,
                merge_count: 1,
            });
        }
        if last_toast_expired {
            self.avatar_bitmap_cache.clear();
        }
        true
    }

    pub(crate) fn clear_hmd_toasts(&self) {
        if let Ok(mut queue) = self.hmd_toasts.lock() {
            queue.clear();
        }
        self.release_hmd_renderer();
    }

    pub fn clear_hmd_notifications(&self) {
        self.clear_hmd_toasts();
        self.reconcile_current();
    }

    fn hmd_notifications_allowed(&self) -> bool {
        self.services
            .as_ref()
            .is_none_or(|services| services.hmd_notifications_allowed())
    }

    pub(crate) fn push_hmd_frame(
        &self,
        manager: &mut VrOverlayManager<HostVrOverlayService>,
        config: VrOverlayRuntimeConfig,
        now: Instant,
    ) {
        let surface_id = OverlaySurfaceId::new(MAIN_SURFACE_ID);
        let toasts = if self.is_test_mode() {
            test_hmd_toast_views()
        } else {
            self.hmd_toast_views(now)
        };
        if toasts.is_empty() {
            if let Err(error) = manager.hide_surface(&surface_id) {
                tracing::warn!(error = %error, "failed to hide HMD overlay surface");
            }
            self.release_hmd_renderer_on_current_thread();
            return;
        }
        let frame = match self.render_hmd_frame(toasts, config) {
            Ok(frame) => frame,
            Err(error) => {
                tracing::warn!(error = %error, "failed to render HMD overlay frame");
                return;
            }
        };
        if let Err(error) = manager.update_surface_frame(&surface_id, frame) {
            tracing::warn!(error = %error, "failed to update HMD overlay frame");
            return;
        }
        if let Err(error) =
            manager.set_surface_alpha(&surface_id, f32::from(config.hmd.opacity_percent) / 100.0)
        {
            tracing::warn!(error = %error, "failed to set HMD overlay alpha");
        }
        if let Err(error) = manager.show_surface(&surface_id) {
            tracing::warn!(error = %error, "failed to show HMD overlay surface");
        }
    }

    fn hmd_toast_views(&self, now: Instant) -> Vec<HmdToastView> {
        let avatars = self.current_runtime_config().hmd.avatars;
        let Ok(mut queue) = self.hmd_toasts.lock() else {
            return Vec::new();
        };
        let last_toast_expired = prune_expired_hmd_toasts(&mut queue, now);
        if queue.is_empty() {
            if last_toast_expired {
                self.avatar_bitmap_cache.clear();
            }
            return Vec::new();
        }
        queue
            .iter_mut()
            .map(|toast| {
                if let Some(services) = &self.services {
                    refresh_cached_location_names(services.as_ref(), &mut toast.entry);
                }
                let show_avatar = avatars && self.is_current_hmd_friend(&toast.entry.actor_user_id);
                HmdToastView {
                    entry: toast.entry.clone(),
                    avatar: if show_avatar {
                        toast.avatar.clone()
                    } else {
                        None
                    },
                    show_avatar,
                    merge_count: toast.merge_count,
                }
            })
            .collect()
    }

    pub(crate) fn hmd_toast_refresh_hint(&self, now: Instant) -> Option<Duration> {
        let queue = self.hmd_toasts.lock().ok()?;
        queue
            .iter()
            .map(|toast| toast.expires_at.saturating_duration_since(now))
            .min()
    }

    fn render_hmd_frame(
        &self,
        toasts: Vec<HmdToastView>,
        config: VrOverlayRuntimeConfig,
    ) -> Result<RgbaFrame, String> {
        let model = build_main_surface_model(MainOverlayFrameInput {
            toasts,
            locale: config.locale,
            show_instance_id_in_location: config.show_instance_id_in_location,
            compact: config.hmd.style == HmdNotificationStyle::Compact,
            stack_upward: config.hmd.position.stacks_upward(),
        });
        render_slint_hmd_frame(&model)
    }

    fn spawn_avatar_fetch(self: &Arc<Self>, entry: &ActivityEntry) {
        if !self.current_runtime_config().hmd.avatars {
            return;
        }
        let Some(services) = self.services.as_ref().cloned() else {
            return;
        };
        let source_id = entry.source_id.trim().to_string();
        if source_id.is_empty() {
            return;
        }
        let actor_user_id = entry.actor_user_id.trim().to_string();
        let endpoint = services.auth_scope().snapshot().endpoint;
        let Some(initial_image_url) = services.notification_friend_image(&endpoint, &actor_user_id)
        else {
            tracing::debug!(
                source_id = %source_id,
                actor_user_id = %actor_user_id,
                "HMD avatar fetch skipped: no cached friend icon for the actor"
            );
            return;
        };
        if let Some(bitmap) = self.cached_hmd_avatar(&initial_image_url, &actor_user_id) {
            self.update_hmd_avatar(&source_id, bitmap);
            return;
        }
        let avatar_cache = Arc::clone(&self.avatar_bitmap_cache);
        let runtime = Arc::clone(self);
        let avatar_cache_generation = avatar_cache.generation();
        let tasks = services.tasks().clone();
        tasks.spawn(async move {
            let Some(bitmap) = avatar_cache
                .resolve(
                    services.web_client().as_ref(),
                    initial_image_url.trim(),
                    &actor_user_id,
                )
                .await
            else {
                tracing::debug!(
                    source_id = %source_id,
                    "HMD avatar fetch failed: avatar bitmap resolve returned none"
                );
                return;
            };
            if !avatar_cache.is_generation_current(avatar_cache_generation) {
                return;
            }
            runtime.update_hmd_avatar(&source_id, bitmap);
        });
    }

    fn cached_hmd_avatar(
        &self,
        initial_image_url: &str,
        actor_user_id: &str,
    ) -> Option<AvatarBitmap> {
        self.avatar_bitmap_cache
            .cached(initial_image_url.trim(), actor_user_id)
    }

    fn update_hmd_avatar(&self, source_id: &str, avatar: AvatarBitmap) {
        let updated = {
            let Ok(mut queue) = self.hmd_toasts.lock() else {
                return;
            };
            let Some(toast) = queue
                .iter_mut()
                .find(|toast| toast.entry.source_id == source_id)
            else {
                tracing::debug!(
                    source_id = %source_id,
                    "HMD avatar arrived after toast expired; dropping"
                );
                return;
            };
            if toast.avatar.as_ref() == Some(&avatar) {
                false
            } else {
                toast.avatar = Some(avatar);
                true
            }
        };
        if updated
            && self
                .hmd_toast_refresh_hint(Instant::now())
                .is_some_and(|hint| !hint.is_zero())
        {
            self.reconcile_current();
        }
    }
}

fn tracker_disconnect_entry(disconnect: TrackerDisconnect) -> ActivityEntry {
    let created_at = Utc::now().to_rfc3339();
    let body = match (disconnect.count, disconnect.battery_percent) {
        (1, Some(percent)) => OverlayMessage::notifications_tracker_disconnected_battery(percent),
        (1, None) => OverlayMessage::notifications_tracker_disconnected(),
        (count, _) => OverlayMessage::notifications_trackers_disconnected(count),
    };
    ActivityEntry {
        sequence: 0,
        source_id: format!("vrcx-0-tracker-disconnected:{created_at}"),
        kind: ActivityKind::Event,
        category: ActivityCategory::SystemSafety,
        created_at,
        actor_user_id: String::new(),
        actor_display_name: String::new(),
        content: ActivityContent {
            title: ActivityText::message(OverlayMessage::notifications_tracker_title()),
            body: ActivityText::message(body),
            ..ActivityContent::default()
        },
        actor_relation: ActivityActorRelation::None,
    }
}

fn prune_expired_hmd_toasts(queue: &mut VecDeque<HmdToastState>, now: Instant) -> bool {
    let had_toasts = !queue.is_empty();
    queue.retain(|toast| now < toast.expires_at);
    had_toasts && queue.is_empty()
}

fn should_merge_hmd_toast(existing: &HmdToastState, entry: &ActivityEntry, now: Instant) -> bool {
    let existing_instance_key = hmd_instance_key(&existing.entry);
    let entry_instance_key = hmd_instance_key(entry);
    existing.last_updated_at + HMD_JOIN_LEAVE_MERGE_WINDOW >= now
        && is_mergeable_hmd_activity(&existing.entry)
        && is_mergeable_hmd_activity(entry)
        && existing.entry.kind == entry.kind
        && existing_instance_key.is_some()
        && existing_instance_key == entry_instance_key
}

fn is_mergeable_hmd_activity(entry: &ActivityEntry) -> bool {
    entry.actor_relation == ActivityActorRelation::None
        && matches!(
            entry.kind,
            ActivityKind::OnPlayerJoined | ActivityKind::OnPlayerLeft
        )
}

fn hmd_instance_key(entry: &ActivityEntry) -> Option<String> {
    let location = parse_location(&entry.content.location);
    if location.world_id.is_empty() || location.instance_name.is_empty() {
        return None;
    }
    Some(format!("{}:{}", location.world_id, location.instance_name))
}

pub(crate) fn unresolved_entry_world_id(entry: &ActivityEntry) -> Option<String> {
    if is_meaningful_world_name(&entry.content.world_name) {
        return None;
    }
    let explicit = entry.content.world_id.trim();
    let world_id = if explicit.is_empty() {
        world_id_from_location(&entry.content.location)
    } else {
        explicit.to_string()
    };
    (!world_id.is_empty()).then_some(world_id)
}

pub(crate) fn refresh_cached_location_names(
    services: &dyn VrOverlayRuntimeServices,
    entry: &mut ActivityEntry,
) {
    if let Some(world_name) = unresolved_entry_world_id(entry)
        .and_then(|world_id| services.world_cache().get_name(&world_id))
    {
        entry.content.world_name = world_name;
    }
    if let Some(group_name) = unresolved_group_id(&entry.content)
        .and_then(|group_id| services.cached_notification_group_name(&group_id))
    {
        entry.content.group_name = group_name;
    }
}

#[cfg(test)]
mod lifecycle_tests;
