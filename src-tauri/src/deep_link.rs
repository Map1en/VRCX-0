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
    OpenInstance {
        world_id: String,
        instance_id: String,
        short_name: String,
    },
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
    if url.host_str() == Some("instance") && url.path() == "/open" {
        return parse_instance_deep_link(&url);
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

fn parse_instance_deep_link(url: &url::Url) -> Option<DeepLinkAction> {
    let mut world_id = None;
    let mut instance_id = None;
    let mut short_name = None;
    for (key, value) in url.query_pairs() {
        let target = match key.as_ref() {
            "id" => &mut world_id,
            "instanceId" => &mut instance_id,
            "shortName" => &mut short_name,
            _ => continue,
        };
        if target.replace(value.into_owned()).is_some() {
            return None;
        }
    }
    let world_id = world_id?;
    let instance_id = instance_id?;
    let short_name = short_name.unwrap_or_default();
    if !is_world_id(&world_id)
        || instance_id.is_empty()
        || instance_id.chars().any(|character| {
            character.is_whitespace()
                || character.is_control()
                || matches!(character, ':' | '/' | '?' | '#' | '&')
        })
        || short_name
            .chars()
            .any(|character| character.is_whitespace() || character.is_control())
    {
        return None;
    }
    Some(DeepLinkAction::OpenInstance {
        world_id,
        instance_id,
        short_name,
    })
}

pub(crate) fn queue_deep_link_action(
    pending: &PendingDeepLinks,
    action: DeepLinkAction,
    after_queue: impl FnOnce(),
) {
    pending.push(action);
    after_queue();
}

fn is_collection_id(value: &str) -> bool {
    (6..=12).contains(&value.len()) && value.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

#[cfg(test)]
mod tests {
    use super::{parse_deep_link, queue_deep_link_action, DeepLinkAction, PendingDeepLinks};

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
    fn parses_open_instance_preserving_access_tags_and_invite_token() {
        let instance_id = "12345~private(usr_12345678-1234-1234-1234-1234567890ab)~canRequestInvite~region(jp)~nonce(ab-cd)";
        let mut url = url::Url::parse("vrcx-0://instance/open").unwrap();
        url.query_pairs_mut()
            .append_pair("id", "wrld_12345678-1234-1234-1234-1234567890ab")
            .append_pair("instanceId", instance_id)
            .append_pair("shortName", "invite+token/=value&part");

        assert_eq!(
            parse_deep_link(url.as_str()),
            Some(DeepLinkAction::OpenInstance {
                world_id: "wrld_12345678-1234-1234-1234-1234567890ab".into(),
                instance_id: instance_id.into(),
                short_name: "invite+token/=value&part".into(),
            })
        );
    }

    #[test]
    fn parses_open_instance_without_invite_token() {
        assert_eq!(
            parse_deep_link("vrcx-0://instance/open?id=wrld_12345678-1234-1234-1234-1234567890ab&instanceId=12345~region(us)"),
            Some(DeepLinkAction::OpenInstance {
                world_id: "wrld_12345678-1234-1234-1234-1234567890ab".into(),
                instance_id: "12345~region(us)".into(),
                short_name: String::new(),
            })
        );
    }

    #[test]
    fn rejects_invalid_or_ambiguous_instance_links() {
        let world_id = "wrld_12345678-1234-1234-1234-1234567890ab";
        for query in [
            format!("id={world_id}"),
            "instanceId=12345".into(),
            "id=invalid&instanceId=12345".into(),
            format!("id={world_id}&instanceId="),
            format!("id={world_id}&id={world_id}&instanceId=12345"),
            format!("id={world_id}&instanceId=12345&instanceId=12345"),
            format!("id={world_id}&instanceId=12345&shortName=&shortName=token"),
            format!("id={world_id}&instanceId=12345&shortName=token%20value"),
            format!("id={world_id}&instanceId=12345&shortName=token%00"),
        ] {
            assert_eq!(
                parse_deep_link(&format!("vrcx-0://instance/open?{query}")),
                None,
                "{query}"
            );
        }
        for invalid_instance_id in [
            "123 45", "123\n45", "123\0", "123:45", "123/45", "123?45", "123#45", "123&45",
        ] {
            let mut url = url::Url::parse("vrcx-0://instance/open").unwrap();
            url.query_pairs_mut()
                .append_pair("id", world_id)
                .append_pair("instanceId", invalid_instance_id);
            assert_eq!(
                parse_deep_link(url.as_str()),
                None,
                "{invalid_instance_id:?}"
            );
        }
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

    #[test]
    fn queue_is_populated_before_wake_side_effects_run() {
        let pending = PendingDeepLinks::default();
        let mut observed = Vec::new();

        queue_deep_link_action(
            &pending,
            DeepLinkAction::ImportCollection {
                collection_id: "AbC123z".into(),
            },
            || observed = pending.drain(),
        );
        assert_eq!(
            observed,
            vec![DeepLinkAction::ImportCollection {
                collection_id: "AbC123z".into()
            }]
        );
        assert!(pending.drain().is_empty());
    }
}
