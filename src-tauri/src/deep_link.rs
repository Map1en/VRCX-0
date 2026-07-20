use std::sync::Mutex;

use vrcx_0_core::vrchat_ids::{is_avatar_id, is_world_id};

pub const DEEP_LINK_ARRIVED_EVENT: &str = "deepLinkArrived";

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DeepLinkAction {
    #[specta(rename_all = "camelCase")]
    OpenWorld { world_id: String },
    #[specta(rename_all = "camelCase")]
    OpenAvatar { avatar_id: String },
    #[specta(rename_all = "camelCase")]
    ImportCollection { collection_id: String },
}

#[derive(Default)]
pub struct PendingDeepLinks {
    actions: Mutex<Vec<DeepLinkAction>>,
}

impl PendingDeepLinks {
    pub fn push(&self, action: DeepLinkAction) {
        if let Ok(mut actions) = self.actions.lock() {
            actions.push(action);
        }
    }

    pub fn drain(&self) -> Vec<DeepLinkAction> {
        self.actions
            .lock()
            .map(|mut actions| actions.drain(..).collect())
            .unwrap_or_default()
    }
}

pub fn parse_deep_link(value: &str) -> Option<DeepLinkAction> {
    let url = url::Url::parse(value.trim()).ok()?;
    if url.scheme() != "vrcx-0" || url.fragment().is_some() {
        return None;
    }
    let id = url
        .query_pairs()
        .find_map(|(key, value)| (key == "id").then(|| value.into_owned()))?;

    match (url.host_str()?, url.path()) {
        ("world", "/open") if is_world_id(&id) => Some(DeepLinkAction::OpenWorld { world_id: id }),
        ("avatar", "/open") if is_avatar_id(&id) => {
            Some(DeepLinkAction::OpenAvatar { avatar_id: id })
        }
        ("collection", "/import") if is_collection_id(&id) => {
            Some(DeepLinkAction::ImportCollection { collection_id: id })
        }
        _ => None,
    }
}

fn is_collection_id(value: &str) -> bool {
    (6..=12).contains(&value.len()) && value.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

#[cfg(test)]
mod tests {
    use super::{parse_deep_link, DeepLinkAction, PendingDeepLinks};

    #[test]
    fn parses_open_world_deep_link_with_full_world_id() {
        let action =
            parse_deep_link("vrcx-0://world/open?id=wrld_12345678-1234-1234-1234-1234567890ab");

        assert_eq!(
            action,
            Some(DeepLinkAction::OpenWorld {
                world_id: "wrld_12345678-1234-1234-1234-1234567890ab".to_string(),
            })
        );
    }

    #[test]
    fn parses_import_collection_deep_link_with_base62_shortcode() {
        let action = parse_deep_link("vrcx-0://collection/import?id=AbC123z");

        assert_eq!(
            action,
            Some(DeepLinkAction::ImportCollection {
                collection_id: "AbC123z".to_string(),
            })
        );
    }

    #[test]
    fn parses_open_avatar_deep_link_with_full_avatar_id() {
        let action =
            parse_deep_link("vrcx-0://avatar/open?id=avtr_12345678-1234-1234-1234-1234567890ab");

        assert_eq!(
            action,
            Some(DeepLinkAction::OpenAvatar {
                avatar_id: "avtr_12345678-1234-1234-1234-1234567890ab".to_string(),
            })
        );
    }

    #[test]
    fn rejects_malformed_deep_link_inputs() {
        for value in [
            "https://worlds.vrcx-0.dev/c/AbC123z",
            "vrcx-0://world/open?id=wrld_not-a-vrchat-id",
            "vrcx-0://avatar/open?id=avtr_not-a-vrchat-id",
            "vrcx-0://collection/import?id=abc/../def",
            "vrcx-0://collection/import?id=AbC123z?x=1",
            "vrcx-0://user/open?id=usr_12345678-1234-1234-1234-1234567890ab",
        ] {
            assert_eq!(parse_deep_link(value), None, "{value}");
        }
    }

    #[test]
    fn pending_deep_links_drain_in_insert_order_and_clear_queue() {
        let pending = PendingDeepLinks::default();
        pending.push(DeepLinkAction::OpenWorld {
            world_id: "wrld_12345678-1234-1234-1234-1234567890ab".to_string(),
        });
        pending.push(DeepLinkAction::OpenAvatar {
            avatar_id: "avtr_12345678-1234-1234-1234-1234567890ab".to_string(),
        });
        pending.push(DeepLinkAction::ImportCollection {
            collection_id: "AbC123z".to_string(),
        });

        assert_eq!(
            pending.drain(),
            vec![
                DeepLinkAction::OpenWorld {
                    world_id: "wrld_12345678-1234-1234-1234-1234567890ab".to_string(),
                },
                DeepLinkAction::OpenAvatar {
                    avatar_id: "avtr_12345678-1234-1234-1234-1234567890ab".to_string(),
                },
                DeepLinkAction::ImportCollection {
                    collection_id: "AbC123z".to_string(),
                },
            ]
        );
        assert!(pending.drain().is_empty());
    }
}
