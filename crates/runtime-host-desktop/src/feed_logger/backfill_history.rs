use serde::{Deserialize, Serialize};
use vrcx_0_application_core::ConfigStore;

use super::{storage, Result};

const CONFIG_KEY_PREFIX: &str = "feedLoggerBackfillHistory:";
const RECENT_LIMIT: usize = 5;

#[derive(Default, Serialize, Deserialize)]
struct StoredHistory {
    #[serde(rename = "t")]
    total: u64,
    #[serde(rename = "r")]
    recent: Vec<(i64, u32)>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FeedLoggerBackfillHistory {
    pub total: u64,
    pub recent: Vec<FeedLoggerBackfillRecord>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FeedLoggerBackfillRecord {
    pub at: i64,
    pub inserted: u32,
}

pub(super) fn record(
    config: &dyn ConfigStore,
    account_id: &str,
    at: i64,
    inserted: u32,
) -> Result<()> {
    let key = config_key(account_id);
    let mut stored = load_stored(config, &key)?;
    stored.total = stored.total.saturating_add(u64::from(inserted));
    stored.recent.push((at, inserted));
    let excess = stored.recent.len().saturating_sub(RECENT_LIMIT);
    stored.recent.drain(..excess);
    let json = serde_json::to_string(&stored).map_err(storage)?;
    config.set_string(&key, &json).map_err(storage)
}

pub(super) fn load(
    config: &dyn ConfigStore,
    account_id: &str,
) -> Result<FeedLoggerBackfillHistory> {
    let stored = load_stored(config, &config_key(account_id))?;
    Ok(FeedLoggerBackfillHistory {
        total: stored.total,
        recent: stored
            .recent
            .into_iter()
            .rev()
            .map(|(at, inserted)| FeedLoggerBackfillRecord { at, inserted })
            .collect(),
    })
}

fn load_stored(config: &dyn ConfigStore, key: &str) -> Result<StoredHistory> {
    Ok(config
        .get_raw(key)
        .map_err(storage)?
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default())
}

fn config_key(account_id: &str) -> String {
    format!("{CONFIG_KEY_PREFIX}{account_id}")
}

#[cfg(test)]
mod tests {
    use crate::notification::test_support::test_config;

    use super::*;

    #[test]
    fn backfills_are_listed_newest_first_with_a_running_total() {
        let (_dir, config) = test_config("backfill-order");
        record(config.as_ref(), "usr_self", 100, 4).unwrap();
        record(config.as_ref(), "usr_self", 200, 6).unwrap();

        assert_eq!(
            load(config.as_ref(), "usr_self").unwrap(),
            FeedLoggerBackfillHistory {
                total: 10,
                recent: vec![
                    FeedLoggerBackfillRecord {
                        at: 200,
                        inserted: 6
                    },
                    FeedLoggerBackfillRecord {
                        at: 100,
                        inserted: 4
                    },
                ],
            }
        );
    }

    #[test]
    fn only_the_latest_backfills_are_kept_while_the_total_keeps_counting() {
        let (_dir, config) = test_config("backfill-limit");
        for at in 0..365 {
            record(config.as_ref(), "usr_self", at, 2).unwrap();
        }

        let history = load(config.as_ref(), "usr_self").unwrap();
        assert_eq!(history.total, 730);
        assert_eq!(history.recent.len(), RECENT_LIMIT);
        assert_eq!(history.recent[0].at, 364);
        assert!(
            config
                .get_raw(&config_key("usr_self"))
                .unwrap()
                .unwrap()
                .len()
                < 300
        );
    }

    #[test]
    fn each_account_keeps_its_own_history() {
        let (_dir, config) = test_config("backfill-accounts");
        record(config.as_ref(), "usr_self", 100, 4).unwrap();

        assert_eq!(
            load(config.as_ref(), "usr_other").unwrap(),
            FeedLoggerBackfillHistory::default()
        );
    }
}
