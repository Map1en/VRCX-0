use std::sync::{Arc, Mutex};

use vrcx_0_runtime_host::notification::{NotificationDeliveryPreferences, RenderedNotification};

pub trait DesktopNotifier: Send + Sync {
    fn show(
        &self,
        title: &str,
        body: Option<&str>,
        image: Option<&str>,
        play_sound: bool,
    ) -> Result<(), String>;
}

#[derive(Clone, Default)]
pub struct DesktopNotifierSlot {
    inner: Arc<Mutex<Option<Arc<dyn DesktopNotifier>>>>,
}

impl DesktopNotifierSlot {
    pub fn set(&self, notifier: Arc<dyn DesktopNotifier>) {
        match self.inner.lock() {
            Ok(mut slot) => {
                *slot = Some(notifier);
            }
            Err(error) => {
                tracing::warn!("failed to set desktop notification bridge: {error}");
            }
        }
    }
}

impl DesktopNotifier for DesktopNotifierSlot {
    fn show(
        &self,
        title: &str,
        body: Option<&str>,
        image: Option<&str>,
        play_sound: bool,
    ) -> Result<(), String> {
        let notifier = self
            .inner
            .lock()
            .map_err(|error| format!("desktop notification bridge lock poisoned: {error}"))?
            .clone();
        let Some(notifier) = notifier else {
            return Ok(());
        };
        notifier.show(title, body, image, play_sound)
    }
}

pub(super) fn send_desktop_notification(
    notifier: &dyn DesktopNotifier,
    render: &RenderedNotification,
    preferences: &NotificationDeliveryPreferences,
    local_image: Option<&str>,
) {
    if let Err(error) = notifier.show(
        &render.title,
        non_empty(&render.body),
        local_image,
        preferences.desktop_notification_sound,
    ) {
        tracing::warn!("[Desktop] notification send failed: {error}");
    }
}

fn non_empty(value: &str) -> Option<&str> {
    let value = value.trim();
    (!value.is_empty()).then_some(value)
}
