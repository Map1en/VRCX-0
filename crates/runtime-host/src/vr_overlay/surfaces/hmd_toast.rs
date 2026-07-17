use std::collections::VecDeque;
use std::sync::Arc;
use std::time::{Duration, Instant};

use vrcx_0_application::{
    OverlayActivityActorRelation, OverlayActivityDelivery, OverlayActivityEntry,
    RealtimeFriendSnapshot, WorldCache,
};
use vrcx_0_core::friends::FriendRecord;
use vrcx_0_core::location::{is_meaningful_world_name, world_id_from_location};
use vrcx_0_vr_overlay::{AvatarBitmap, OverlaySurfaceId, RgbaFrame, MAIN_SURFACE_ID};

use crate::notification::user_image::normalize_avatar_image_url_128;

use super::super::localization::OverlayLocale;
use super::super::manager::VrOverlayManager;
use super::super::runtime::{render_slint_hmd_frame, VrOverlayRuntime, VrOverlayRuntimeConfig};
use super::super::service::HostVrOverlayService;
use super::friends::{first_non_empty, friend_record_avatar_url};
use super::main::{build_main_surface_model, HmdToastView, MainOverlayFrameInput};

const HMD_TOAST_CAPACITY: usize = 3;
const HMD_TOAST_WORLD_RESOLVE_BUDGET: Duration = Duration::from_secs(2);
const HMD_JOIN_LEAVE_MERGE_WINDOW: Duration = Duration::from_secs(4);

#[derive(Clone)]
pub(crate) struct HmdToastState {
    entry: OverlayActivityEntry,
    expires_at: Instant,
    last_updated_at: Instant,
    avatar: Option<AvatarBitmap>,
    merge_count: u32,
}

impl VrOverlayRuntime {
    pub(in crate::vr_overlay) fn ingest_hmd_delivery(
        self: &Arc<Self>,
        delivery: OverlayActivityDelivery,
    ) {
        if !delivery.hmd || !self.is_hmd_surface_active(self.current_runtime_config()) {
            return;
        }
        let entry = delivery.entry;
        let pending = self
            .context
            .as_ref()
            .cloned()
            .zip(unresolved_entry_world_id(&entry));
        let Some((context, world_id)) = pending else {
            self.deliver_hmd_toast(entry);
            return;
        };
        let runtime = Arc::clone(self);
        let tasks = context.tasks.clone();
        tasks.spawn(async move {
            let mut entry = entry;
            let endpoint = context.auth_scope.snapshot().endpoint;
            if !endpoint.trim().is_empty() {
                let resolve =
                    context
                        .world_cache
                        .resolve_name(context.web.as_ref(), &endpoint, &world_id);
                if let Ok(Some(world_name)) =
                    tokio::time::timeout(HMD_TOAST_WORLD_RESOLVE_BUDGET, resolve).await
                {
                    entry.content.world_name = world_name;
                }
            }
            runtime.deliver_hmd_toast(entry);
        });
    }

    fn deliver_hmd_toast(self: &Arc<Self>, entry: OverlayActivityEntry) {
        let config = self.current_runtime_config();
        if !self.is_hmd_surface_active(config) {
            return;
        }
        let timeout = Duration::from_millis(config.hmd.timeout_ms);
        if !self.enqueue_hmd_toast(entry.clone(), Instant::now(), timeout) {
            return;
        }
        self.spawn_avatar_fetch(&entry);
        self.reconcile_current();
    }

    fn enqueue_hmd_toast(
        &self,
        entry: OverlayActivityEntry,
        now: Instant,
        timeout: Duration,
    ) -> bool {
        let Ok(mut queue) = self.hmd_toasts.lock() else {
            return false;
        };
        prune_expired_hmd_toasts(&mut queue, now);
        if let Some(existing) = queue
            .iter_mut()
            .rev()
            .find(|toast| should_merge_hmd_toast(toast, &entry, now))
        {
            existing.entry = entry;
            existing.merge_count = existing.merge_count.saturating_add(1);
            existing.expires_at = now + timeout;
            existing.last_updated_at = now;
            return true;
        }
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
        true
    }

    pub(in crate::vr_overlay) fn clear_hmd_toasts(&self) {
        if let Ok(mut queue) = self.hmd_toasts.lock() {
            queue.clear();
        }
        self.release_hmd_renderer();
    }

    pub(in crate::vr_overlay) fn push_hmd_frame(
        &self,
        manager: &mut VrOverlayManager<HostVrOverlayService>,
        config: VrOverlayRuntimeConfig,
        now: Instant,
    ) {
        let surface_id = OverlaySurfaceId::new(MAIN_SURFACE_ID);
        let toasts = self.hmd_toast_views(now);
        if toasts.is_empty() {
            if let Err(error) = manager.hide_surface(&surface_id) {
                tracing::warn!(error = %error, "failed to hide HMD overlay surface");
            }
            self.release_hmd_renderer_on_current_thread();
            return;
        }
        let frame =
            match self.render_hmd_frame(toasts, config.locale, config.show_instance_id_in_location)
            {
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
        let Ok(mut queue) = self.hmd_toasts.lock() else {
            return Vec::new();
        };
        prune_expired_hmd_toasts(&mut queue, now);
        let friend_snapshot = self.current_friends_panel_snapshot();
        if let Some(context) = &self.context {
            for toast in queue.iter_mut() {
                refresh_cached_world_name(&context.world_cache, &mut toast.entry);
            }
        }
        queue
            .iter()
            .map(|toast| {
                let show_avatar = hmd_entry_should_show_avatar(&toast.entry, &friend_snapshot);
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

    fn render_hmd_frame(
        &self,
        toasts: Vec<HmdToastView>,
        locale: OverlayLocale,
        show_instance_id_in_location: bool,
    ) -> Result<RgbaFrame, String> {
        let model = build_main_surface_model(MainOverlayFrameInput {
            toasts,
            locale,
            show_instance_id_in_location,
        });
        render_slint_hmd_frame(&model)
    }

    fn hmd_avatar_friend_context(&self, actor_user_id: &str) -> Option<(FriendRecord, String)> {
        let actor_user_id = actor_user_id.trim();
        if !actor_user_id.starts_with("usr_") {
            return None;
        }
        let snapshot = self.current_friends_panel_snapshot()?;
        let record = snapshot.friends_by_id.get(actor_user_id)?.clone();
        Some((record, snapshot.endpoint))
    }

    fn spawn_avatar_fetch(self: &Arc<Self>, entry: &OverlayActivityEntry) {
        let Some(context) = self.context.as_ref().cloned() else {
            return;
        };
        let source_id = entry.source_id.trim().to_string();
        if source_id.is_empty() {
            return;
        }
        let actor_user_id = entry.actor_user_id.trim().to_string();
        let Some((friend_record, snapshot_endpoint)) =
            self.hmd_avatar_friend_context(&actor_user_id)
        else {
            tracing::debug!(
                source_id = %source_id,
                actor_user_id = %actor_user_id,
                "HMD avatar fetch skipped: actor is not in the current friend snapshot"
            );
            return;
        };
        let auth = context.auth_scope.snapshot();
        let endpoint = if snapshot_endpoint.trim().is_empty() {
            auth.endpoint.clone()
        } else {
            snapshot_endpoint
        };
        let allow_user_icon = context
            .config()
            .get_bool("displayVRCPlusIconsAsAvatar", true)
            .unwrap_or(true);
        let friend_image_url = friend_record_avatar_url(&friend_record, allow_user_icon, &endpoint);
        let entry_image_url = normalize_avatar_image_url_128(&entry.content.image_url, &endpoint);
        let initial_image_url =
            first_non_empty([friend_image_url.as_str(), entry_image_url.as_str()]).to_string();
        if let Some(bitmap) =
            self.cached_hmd_avatar(&initial_image_url, &actor_user_id, allow_user_icon)
        {
            self.update_hmd_avatar(&source_id, bitmap);
            return;
        }
        let user_image_cache = Arc::clone(&self.user_image_cache);
        let avatar_cache = Arc::clone(&self.avatar_bitmap_cache);
        let runtime = Arc::clone(self);
        let resolve_endpoint = endpoint.clone();
        let avatar_cache_generation = avatar_cache.generation();
        let tasks = context.tasks.clone();
        tasks.spawn(async move {
            let image_url = if initial_image_url.is_empty() {
                if actor_user_id == auth.current_user_id {
                    return;
                }
                user_image_cache
                    .resolve(
                        context.web.as_ref(),
                        context.db.as_ref(),
                        &resolve_endpoint,
                        &actor_user_id,
                        allow_user_icon,
                    )
                    .await
                    .unwrap_or_default()
            } else {
                initial_image_url
            };
            if image_url.trim().is_empty() {
                tracing::debug!(
                    source_id = %source_id,
                    actor_user_id = %actor_user_id,
                    "HMD avatar fetch skipped: user image resolution returned empty url"
                );
                return;
            }
            let Some(bitmap) = avatar_cache
                .resolve(context.web.as_ref(), image_url.trim(), &actor_user_id)
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
        allow_user_icon: bool,
    ) -> Option<AvatarBitmap> {
        let url = if initial_image_url.is_empty() {
            self.user_image_cache
                .cached_url(actor_user_id, allow_user_icon)?
        } else {
            initial_image_url.to_string()
        };
        self.avatar_bitmap_cache.cached(url.trim(), actor_user_id)
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
        if updated {
            self.reconcile_current();
        }
    }
}

fn prune_expired_hmd_toasts(queue: &mut VecDeque<HmdToastState>, now: Instant) {
    queue.retain(|toast| toast.expires_at > now);
}

fn hmd_entry_should_show_avatar(
    entry: &OverlayActivityEntry,
    snapshot: &Option<RealtimeFriendSnapshot>,
) -> bool {
    let actor_user_id = entry.actor_user_id.trim();
    actor_user_id.starts_with("usr_")
        && snapshot
            .as_ref()
            .is_some_and(|snapshot| snapshot.friends_by_id.contains_key(actor_user_id))
}

fn should_merge_hmd_toast(
    existing: &HmdToastState,
    entry: &OverlayActivityEntry,
    now: Instant,
) -> bool {
    let existing_instance_key = hmd_instance_key(&existing.entry);
    let entry_instance_key = hmd_instance_key(entry);
    existing.last_updated_at + HMD_JOIN_LEAVE_MERGE_WINDOW >= now
        && is_mergeable_hmd_activity(&existing.entry)
        && is_mergeable_hmd_activity(entry)
        && existing.entry.activity_type == entry.activity_type
        && existing_instance_key.is_some()
        && existing_instance_key == entry_instance_key
}

fn is_mergeable_hmd_activity(entry: &OverlayActivityEntry) -> bool {
    entry.actor_relation == OverlayActivityActorRelation::None
        && matches!(
            entry.activity_type.as_str(),
            "OnPlayerJoined" | "OnPlayerLeft"
        )
}

fn hmd_instance_key(entry: &OverlayActivityEntry) -> Option<String> {
    [
        entry.content.location.as_str(),
        entry.content.display_location.as_str(),
        entry.content.world_id.as_str(),
        entry.content.world_name.as_str(),
    ]
    .into_iter()
    .map(str::trim)
    .find(|value| !value.is_empty())
    .map(str::to_string)
}

fn unresolved_entry_world_id(entry: &OverlayActivityEntry) -> Option<String> {
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

pub(in crate::vr_overlay) fn refresh_cached_world_name(
    world_cache: &WorldCache,
    entry: &mut OverlayActivityEntry,
) {
    let Some(world_id) = unresolved_entry_world_id(entry) else {
        return;
    };
    if let Some(world_name) = world_cache.get_name(&world_id) {
        entry.content.world_name = world_name;
    }
}

#[cfg(test)]
mod tests;
