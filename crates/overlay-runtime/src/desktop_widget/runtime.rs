use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;

use vrcx_0_application_activity::notification::unresolved_group_id;
use vrcx_0_application_activity::{ActivityDelivery, ActivityEntry};
use vrcx_0_persistence::config::ConfigRepository;
use vrcx_0_vr_overlay::DesktopWidgetRow;

use super::feed::{DesktopWidgetFeed, DesktopWidgetRowPart, DesktopWidgetTarget};
use super::settings::{DesktopWidgetBounds, DesktopWidgetSettings};
use crate::avatar_cache::AvatarBitmapCache;
use crate::config::load_localizer;
use crate::surfaces::hmd_toast::unresolved_entry_world_id;
use crate::VrOverlayRuntimeServices;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DesktopWidgetState {
    pub enabled: bool,
    pub pinned: bool,
    pub click_through: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DesktopWidgetMenuCommand {
    TogglePinned,
    ToggleClickThrough,
    Close,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DesktopWidgetView {
    pub rows: Vec<DesktopWidgetRow>,
    pub settings: DesktopWidgetSettings,
}

pub trait DesktopWidgetHost: Send + Sync {
    fn open_target(&self, target: DesktopWidgetTarget);

    fn state_changed(&self, state: DesktopWidgetState);
}

pub trait DesktopWidgetWindows: Send + Sync {
    fn open(&self, runtime: Weak<DesktopWidgetRuntime>) -> Box<dyn DesktopWidgetWindow>;
}

pub trait DesktopWidgetWindow: Send {
    fn refresh(&self);

    fn bring_to_front(&self);

    fn close(self: Box<Self>);
}

const LOCATION_NAME_RESOLVE_BUDGET: Duration = Duration::from_secs(2);

struct Inner {
    settings: DesktopWidgetSettings,
    locked: bool,
    shut_down: bool,
    feed: DesktopWidgetFeed,
    window: Option<Box<dyn DesktopWidgetWindow>>,
}

pub struct DesktopWidgetRuntime {
    self_ref: Weak<Self>,
    config: ConfigRepository,
    host: Arc<dyn DesktopWidgetHost>,
    windows: Arc<dyn DesktopWidgetWindows>,
    services: Mutex<Option<Arc<dyn VrOverlayRuntimeServices>>>,
    avatars: Arc<AvatarBitmapCache>,
    inner: Mutex<Inner>,
}

impl DesktopWidgetRuntime {
    pub fn new(
        config: ConfigRepository,
        host: Arc<dyn DesktopWidgetHost>,
        windows: Arc<dyn DesktopWidgetWindows>,
        privacy_locked: bool,
    ) -> Arc<Self> {
        let settings = DesktopWidgetSettings::load(&config);
        let runtime = Arc::new_cyclic(|self_ref| Self {
            self_ref: self_ref.clone(),
            config,
            host,
            windows,
            services: Mutex::new(None),
            avatars: Arc::new(AvatarBitmapCache::new()),
            inner: Mutex::new(Inner {
                settings,
                locked: privacy_locked,
                shut_down: false,
                feed: DesktopWidgetFeed::default(),
                window: None,
            }),
        });
        runtime.sync_window();
        runtime
    }

    pub fn attach_services(&self, services: Arc<dyn VrOverlayRuntimeServices>) {
        if let Ok(mut slot) = self.services.lock() {
            *slot = Some(services);
        }
    }

    pub fn state(&self) -> DesktopWidgetState {
        self.inner
            .lock()
            .map(|inner| state_of(&inner.settings))
            .unwrap_or_default()
    }

    pub fn set_enabled(&self, enabled: bool) -> vrcx_0_persistence::Result<DesktopWidgetState> {
        self.update_settings(|settings| settings.enabled = enabled)
    }

    pub fn menu_command(
        &self,
        command: DesktopWidgetMenuCommand,
    ) -> vrcx_0_persistence::Result<DesktopWidgetState> {
        self.update_settings(|settings| match command {
            DesktopWidgetMenuCommand::TogglePinned => settings.set_pinned(!settings.pinned),
            DesktopWidgetMenuCommand::ToggleClickThrough => {
                settings.set_click_through(!settings.click_through)
            }
            DesktopWidgetMenuCommand::Close => settings.enabled = false,
        })
    }

    pub fn bring_to_front(&self) {
        if let Ok(inner) = self.inner.lock() {
            if let Some(window) = &inner.window {
                window.bring_to_front();
            }
        }
    }

    pub fn reload_settings(&self) {
        let loaded = DesktopWidgetSettings::load(&self.config);
        let changed_state = {
            let Ok(mut inner) = self.inner.lock() else {
                return;
            };
            let previous = state_of(&inner.settings);
            inner.settings = loaded;
            (previous != state_of(&loaded)).then(|| state_of(&loaded))
        };
        self.sync_window();
        self.refresh();
        if let Some(state) = changed_state {
            self.host.state_changed(state);
        }
    }

    pub fn set_privacy_locked(&self, locked: bool) {
        let changed = self
            .inner
            .lock()
            .map(|mut inner| std::mem::replace(&mut inner.locked, locked) != locked)
            .unwrap_or(false);
        if changed {
            self.sync_window();
        }
    }

    pub fn shutdown(&self) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.shut_down = true;
        }
        self.sync_window();
    }

    pub fn clear_activity(&self) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.feed.clear();
        }
        self.avatars.clear();
        self.refresh();
    }

    pub fn ingest_delivery(&self, delivery: ActivityDelivery) {
        if !delivery.widget {
            return;
        }
        let entry = delivery.entry;
        {
            let Ok(mut inner) = self.inner.lock() else {
                return;
            };
            if !inner.settings.enabled {
                return;
            }
            inner.feed.push(entry.clone());
        }
        self.refresh();
        self.spawn_enrichment(entry);
    }

    pub fn view(&self) -> DesktopWidgetView {
        let localizer = load_localizer(&self.config);
        let Ok(inner) = self.inner.lock() else {
            return DesktopWidgetView {
                rows: Vec::new(),
                settings: DesktopWidgetSettings::load(&self.config),
            };
        };
        DesktopWidgetView {
            rows: inner.feed.rows(&localizer),
            settings: inner.settings,
        }
    }

    #[cfg(windows)]
    pub(crate) fn app_language(&self) -> String {
        crate::config::load_app_language(&self.config)
    }

    pub fn activate(&self, id: u64, part: DesktopWidgetRowPart) {
        let target = self
            .inner
            .lock()
            .ok()
            .and_then(|inner| inner.feed.target(id, part));
        if let Some(target) = target {
            self.host.open_target(target);
        }
    }

    pub fn save_bounds(&self, bounds: DesktopWidgetBounds) {
        let settings = {
            let Ok(mut inner) = self.inner.lock() else {
                return;
            };
            if inner.settings.bounds == Some(bounds) {
                return;
            }
            inner.settings.bounds = Some(bounds);
            inner.settings
        };
        if let Err(error) = settings.save(&self.config) {
            tracing::warn!(error = %error, "failed to save desktop widget bounds");
        }
    }

    fn update_settings(
        &self,
        update: impl FnOnce(&mut DesktopWidgetSettings),
    ) -> vrcx_0_persistence::Result<DesktopWidgetState> {
        let state = {
            let mut inner = self
                .inner
                .lock()
                .map_err(|error| vrcx_0_persistence::Error::Custom(error.to_string()))?;
            let mut settings = inner.settings;
            update(&mut settings);
            settings.save(&self.config)?;
            inner.settings = settings;
            state_of(&settings)
        };
        self.sync_window();
        self.refresh();
        self.host.state_changed(state);
        Ok(state)
    }

    fn sync_window(&self) {
        let (open, closing) = {
            let Ok(mut inner) = self.inner.lock() else {
                return;
            };
            let wanted = inner.settings.enabled && !inner.locked && !inner.shut_down;
            if wanted == inner.window.is_some() {
                return;
            }
            (wanted, inner.window.take())
        };
        if let Some(window) = closing {
            window.close();
        }
        if !open {
            return;
        }
        let window = self.windows.open(self.self_ref.clone());
        let stale = {
            let Ok(mut inner) = self.inner.lock() else {
                return;
            };
            if inner.settings.enabled && !inner.locked && !inner.shut_down && inner.window.is_none()
            {
                inner.window = Some(window);
                None
            } else {
                Some(window)
            }
        };
        if let Some(window) = stale {
            window.close();
        }
    }

    fn refresh(&self) {
        if let Ok(inner) = self.inner.lock() {
            if let Some(window) = &inner.window {
                window.refresh();
            }
        }
    }

    fn spawn_enrichment(&self, entry: ActivityEntry) {
        let Some(services) = self.services.lock().ok().and_then(|slot| slot.clone()) else {
            return;
        };
        let Some(runtime) = self.self_ref.upgrade() else {
            return;
        };
        let endpoint = services.auth_scope().snapshot().endpoint;
        if endpoint.trim().is_empty() {
            return;
        }
        let tasks = services.tasks().clone();
        tasks.spawn(async move {
            let source_id = entry.source_id.clone();
            if let Some(world_id) = unresolved_entry_world_id(&entry) {
                let resolve = services.world_cache().resolve_name(
                    services.web_client().as_ref(),
                    &endpoint,
                    &world_id,
                );
                if let Ok(Some(world_name)) =
                    tokio::time::timeout(LOCATION_NAME_RESOLVE_BUDGET, resolve).await
                {
                    runtime.update_row(|feed| feed.resolve_world_name(&source_id, &world_name));
                }
            }
            if let Some(group_id) = unresolved_group_id(&entry.content) {
                let resolve = services.notification_group_name(&endpoint, &group_id);
                if let Ok(Some(group_name)) =
                    tokio::time::timeout(LOCATION_NAME_RESOLVE_BUDGET, resolve).await
                {
                    runtime.update_row(|feed| feed.resolve_group_name(&source_id, &group_name));
                }
            }
            let user_id = entry.actor_user_id.trim();
            let Some(image_url) = services.notification_friend_image(&endpoint, user_id) else {
                return;
            };
            if let Some(avatar) = runtime
                .avatars
                .resolve(services.web_client().as_ref(), &image_url, user_id)
                .await
            {
                runtime.update_row(|feed| feed.set_avatar(&source_id, avatar));
            }
        });
    }

    fn update_row(&self, update: impl FnOnce(&mut DesktopWidgetFeed) -> bool) {
        let changed = self
            .inner
            .lock()
            .map(|mut inner| update(&mut inner.feed))
            .unwrap_or(false);
        if changed {
            self.refresh();
        }
    }
}

fn state_of(settings: &DesktopWidgetSettings) -> DesktopWidgetState {
    DesktopWidgetState {
        enabled: settings.enabled,
        pinned: settings.pinned,
        click_through: settings.click_through,
    }
}

#[cfg(test)]
mod tests;
