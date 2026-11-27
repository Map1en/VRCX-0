use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use vrcx_0_application_activity::notification::reload_activity_router;
use vrcx_0_application_activity::ActivityRouter;
use vrcx_0_application_core::{ConfigStore, Error, Result};
use vrcx_0_contracts::{
    is_notification_sound_event, parse_notification_sound_rules, NotificationSoundRule,
    NotificationSoundSource, NOTIFICATION_SOUND_RULES_CONFIG_KEY,
};
use vrcx_0_host_desktop::notification_sound::{
    is_builtin_notification_sound, NotificationSoundGuard, NotificationSoundPlayer,
};

pub(crate) struct NotificationSounds {
    config: Arc<dyn ConfigStore>,
    player: Arc<NotificationSoundPlayer>,
    rule_writes: Mutex<()>,
}

impl NotificationSounds {
    pub(crate) fn new(config: Arc<dyn ConfigStore>) -> Self {
        Self {
            config,
            player: Arc::new(NotificationSoundPlayer::new()),
            rule_writes: Mutex::new(()),
        }
    }

    pub(crate) fn rules(&self) -> Result<BTreeMap<String, NotificationSoundRule>> {
        Ok(self
            .config
            .get_raw(NOTIFICATION_SOUND_RULES_CONFIG_KEY)?
            .map_or_else(BTreeMap::new, |raw| parse_notification_sound_rules(&raw)))
    }

    pub(crate) fn player(&self) -> Arc<NotificationSoundPlayer> {
        Arc::clone(&self.player)
    }

    pub(super) fn play(&self, rule: NotificationSoundRule, allowed: NotificationSoundGuard) {
        self.player.play(rule, allowed);
    }

    pub(crate) fn set_rule(
        &self,
        activity_router: &ActivityRouter,
        event: String,
        rule: Option<NotificationSoundRule>,
    ) -> Result<()> {
        let event = event.trim();
        if !is_notification_sound_event(event) {
            return Err(Error::Custom("Unknown notification sound event.".into()));
        }

        let _write = self
            .rule_writes
            .lock()
            .map_err(|_| Error::Custom("Notification sound settings are unavailable.".into()))?;
        let mut rules = self.rules()?;
        match rule {
            Some(rule) => {
                if rule.volume > 100 {
                    return Err(Error::Custom(
                        "Notification sound volume must be 0–100.".into(),
                    ));
                }
                if let NotificationSoundSource::Builtin { id } = &rule.source {
                    if !is_builtin_notification_sound(id) {
                        return Err(Error::Custom("Unknown built-in notification sound.".into()));
                    }
                }
                rules.insert(event.to_owned(), rule);
            }
            None => {
                rules.remove(event);
            }
        }
        let value = serde_json::to_value(rules).map_err(Error::Json)?;
        self.config
            .set_json(NOTIFICATION_SOUND_RULES_CONFIG_KEY, &value)?;
        reload_activity_router(activity_router, self.config.as_ref());
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use vrcx_0_application_activity::notification::load_notification_sound_rules;
    use vrcx_0_application_core::MemoryConfigStore;

    #[test]
    fn saves_and_removes_rules_individually() {
        let config = Arc::new(MemoryConfigStore::default());
        let sounds = NotificationSounds::new(config.clone());
        let router = ActivityRouter::new();
        let rule = NotificationSoundRule {
            source: NotificationSoundSource::Builtin {
                id: "notify_01_ding".into(),
            },
            volume: 30,
        };
        let custom = NotificationSoundRule {
            source: NotificationSoundSource::Custom {
                path: "/sound/test.wav".into(),
            },
            volume: 55,
        };
        sounds
            .set_rule(&router, "PortalSpawn".into(), Some(rule))
            .unwrap();
        sounds
            .set_rule(&router, "OnPlayerLeft".into(), Some(custom.clone()))
            .unwrap();
        sounds
            .set_rule(&router, "PortalSpawn".into(), None)
            .unwrap();
        assert!(sounds.set_rule(&router, "Unknown".into(), None).is_err());
        assert_eq!(
            load_notification_sound_rules(config.as_ref()),
            BTreeMap::from([("OnPlayerLeft".into(), custom)])
        );
    }
}
