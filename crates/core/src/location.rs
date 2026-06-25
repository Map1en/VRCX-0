//! Canonical VRChat location-tag parser.
//!
//! A VRChat location tag looks like
//! `wrld_<id>:<instanceName>~<segment>~<segment>...&shortName=<code>` (plus the
//! sentinels `offline` / `private` / `traveling`). This module is the single
//! source of truth for turning that string into structured data; every realtime,
//! presence, and Discord path consumes it instead of re-implementing parsing.

use serde::Serialize;
use serde_json::{json, Value};

#[derive(Clone, Debug, Default, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ParsedLocation {
    pub tag: String,
    pub is_offline: bool,
    pub is_private: bool,
    pub is_traveling: bool,
    pub is_real_instance: bool,
    pub world_id: String,
    pub instance_id: String,
    pub instance_name: String,
    pub access_type: String,
    pub access_type_name: String,
    pub region: String,
    pub short_name: String,
    pub user_id: Option<String>,
    pub hidden_id: Option<String>,
    pub private_id: Option<String>,
    pub friends_id: Option<String>,
    pub group_id: Option<String>,
    pub group_access_type: Option<String>,
    pub can_request_invite: bool,
    pub strict: bool,
    pub age_gate: bool,
}

impl ParsedLocation {
    pub fn to_frontend_value(&self, tag: &str) -> Value {
        json!({
            "tag": tag,
            "isOffline": self.is_offline,
            "isPrivate": self.is_private,
            "isTraveling": self.is_traveling,
            "isRealInstance": self.is_real_instance,
            "worldId": self.world_id,
            "instanceId": self.instance_id,
            "instanceName": self.instance_name,
            "accessType": self.access_type,
            "accessTypeName": self.access_type_name,
            "region": self.region,
            "shortName": self.short_name,
            "userId": self.user_id,
            "hiddenId": self.hidden_id,
            "privateId": self.private_id,
            "friendsId": self.friends_id,
            "groupId": self.group_id,
            "groupAccessType": self.group_access_type,
            "canRequestInvite": self.can_request_invite,
            "strict": self.strict,
            "ageGate": self.age_gate,
        })
    }
}

pub fn parse_location(tag: &str) -> ParsedLocation {
    let mut raw = tag.trim().to_string();
    let mut parsed = ParsedLocation {
        tag: raw.clone(),
        ..Default::default()
    };
    match raw.as_str() {
        "offline" | "offline:offline" => {
            parsed.is_offline = true;
            return parsed;
        }
        "private" | "private:private" => {
            parsed.is_private = true;
            return parsed;
        }
        "traveling" | "traveling:traveling" => {
            parsed.is_traveling = true;
            return parsed;
        }
        _ => {}
    }
    if raw.is_empty() || raw.starts_with("local") {
        return parsed;
    }
    parsed.is_real_instance = true;
    const SHORT_NAME_QUALIFIER: &str = "&shortName=";
    if let Some(index) = raw.find(SHORT_NAME_QUALIFIER) {
        parsed.short_name = raw[index + SHORT_NAME_QUALIFIER.len()..].to_string();
        raw.truncate(index);
    }
    if let Some(separator) = raw.find(':') {
        parsed.world_id = raw[..separator].to_string();
        parsed.instance_id = raw[separator + 1..].to_string();
        for (index, segment) in parsed.instance_id.split('~').enumerate() {
            if index == 0 {
                parsed.instance_name = segment.to_string();
                continue;
            }
            let (key, value) = parse_location_segment(segment);
            match key.as_str() {
                "hidden" => parsed.hidden_id = Some(value),
                "private" => parsed.private_id = Some(value),
                "friends" => parsed.friends_id = Some(value),
                "canRequestInvite" => parsed.can_request_invite = true,
                "region" => parsed.region = value,
                "group" => parsed.group_id = Some(value),
                "groupAccessType" => parsed.group_access_type = Some(value),
                "strict" => parsed.strict = true,
                "ageGate" => parsed.age_gate = true,
                _ => {}
            }
        }
        parsed.access_type = "public".into();
        if let Some(value) = parsed.private_id.clone() {
            parsed.access_type = if parsed.can_request_invite {
                "invite+".into()
            } else {
                "invite".into()
            };
            parsed.user_id = Some(value);
        } else if let Some(value) = parsed.friends_id.clone() {
            parsed.access_type = "friends".into();
            parsed.user_id = Some(value);
        } else if let Some(value) = parsed.hidden_id.clone() {
            parsed.access_type = "friends+".into();
            parsed.user_id = Some(value);
        } else if parsed.group_id.is_some() {
            parsed.access_type = "group".into();
        }
        parsed.access_type_name = parsed.access_type.clone();
        if let Some(group_access_type) = parsed.group_access_type.as_deref() {
            if group_access_type == "public" {
                parsed.access_type_name = "groupPublic".into();
            } else if group_access_type == "plus" {
                parsed.access_type_name = "groupPlus".into();
            }
        }
    } else {
        parsed.world_id = raw;
    }
    parsed
}

fn parse_location_segment(segment: &str) -> (String, String) {
    let Some(open) = segment.find('(') else {
        return (segment.to_string(), String::new());
    };
    let Some(close) = segment.rfind(')') else {
        return (segment.to_string(), String::new());
    };
    if open >= close {
        return (segment.to_string(), String::new());
    }
    (
        segment[..open].to_string(),
        segment[open + 1..close].to_string(),
    )
}

pub fn normalize_instance_type(parsed: &ParsedLocation) -> String {
    if parsed.access_type != "group" {
        return parsed.access_type.clone();
    }
    match parsed.group_access_type.as_deref() {
        Some("members") => "groupOnly".into(),
        Some("plus") => "groupPlus".into(),
        _ => "groupPublic".into(),
    }
}

pub fn format_display_location(
    parsed: &ParsedLocation,
    world_name: &str,
    group_name: &str,
) -> String {
    format_display_location_parts(
        parsed,
        world_name,
        group_name,
        parsed.access_type_name.as_str(),
    )
}

pub struct DisplayLocationLabels<'a> {
    pub public: &'a str,
    pub invite: &'a str,
    pub invite_plus: &'a str,
    pub friends: &'a str,
    pub friends_plus: &'a str,
    pub group: &'a str,
    pub group_public: &'a str,
    pub group_plus: &'a str,
}

pub fn format_display_location_with_labels(
    parsed: &ParsedLocation,
    world_name: &str,
    group_name: &str,
    labels: &DisplayLocationLabels<'_>,
) -> String {
    format_display_location_parts(
        parsed,
        world_name,
        group_name,
        access_type_label(parsed, labels),
    )
}

fn access_type_label<'a>(
    parsed: &'a ParsedLocation,
    labels: &'a DisplayLocationLabels<'a>,
) -> &'a str {
    match parsed.access_type_name.as_str() {
        "public" => labels.public,
        "invite" => labels.invite,
        "invite+" => labels.invite_plus,
        "friends" => labels.friends,
        "friends+" => labels.friends_plus,
        "group" => labels.group,
        "groupPublic" => labels.group_public,
        "groupPlus" => labels.group_plus,
        _ => parsed.access_type_name.as_str(),
    }
}

fn format_display_location_parts(
    parsed: &ParsedLocation,
    world_name: &str,
    group_name: &str,
    access_type_name: &str,
) -> String {
    if parsed.is_offline {
        return "Offline".to_string();
    }
    if parsed.is_private {
        return "Private".to_string();
    }
    if parsed.is_traveling {
        return "Traveling".to_string();
    }
    let world_name = readable_location_part(world_name);
    let group_name = readable_location_part(group_name);
    if !parsed.world_id.is_empty() {
        if !group_name.is_empty() {
            return format!("{world_name} {access_type_name}({group_name})")
                .trim()
                .to_string();
        }
        if !parsed.instance_id.is_empty() {
            return format!("{world_name} {access_type_name}")
                .trim()
                .to_string();
        }
    }
    world_name.to_string()
}

pub fn is_meaningful_world_name(value: &str) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty() && !trimmed.starts_with("wrld_")
}

fn readable_location_part(value: &str) -> &str {
    let trimmed = value.trim();
    if trimmed == "private"
        || trimmed == "private:private"
        || trimmed.starts_with("wrld_")
        || trimmed.starts_with("grp_")
    {
        ""
    } else {
        trimmed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sentinels_short_circuit_without_world() {
        for (tag, is_offline, is_private, is_traveling) in [
            ("offline", true, false, false),
            ("offline:offline", true, false, false),
            ("private", false, true, false),
            ("private:private", false, true, false),
            ("traveling", false, false, true),
            ("traveling:traveling", false, false, true),
        ] {
            let parsed = parse_location(tag);
            assert_eq!(parsed.is_offline, is_offline, "{tag}");
            assert_eq!(parsed.is_private, is_private, "{tag}");
            assert_eq!(parsed.is_traveling, is_traveling, "{tag}");
            assert!(!parsed.is_real_instance, "{tag}");
            assert_eq!(parsed.world_id, "", "{tag}");
            assert_eq!(parsed.instance_id, "", "{tag}");
        }
    }

    #[test]
    fn empty_and_local_are_not_real_instances() {
        for tag in ["", "local", "local:1234"] {
            let parsed = parse_location(tag);
            assert!(!parsed.is_real_instance, "{tag}");
            assert_eq!(parsed.world_id, "", "{tag}");
        }
    }

    #[test]
    fn public_instance_parses_world_instance_region() {
        let parsed = parse_location("wrld_abc:12345~region(use)");
        assert!(parsed.is_real_instance);
        assert_eq!(parsed.world_id, "wrld_abc");
        assert_eq!(parsed.instance_id, "12345~region(use)");
        assert_eq!(parsed.instance_name, "12345");
        assert_eq!(parsed.access_type, "public");
        assert_eq!(parsed.region, "use");
    }

    #[test]
    fn access_types_are_derived_from_segments() {
        let invite = parse_location("wrld_a:1~private(usr_x)");
        assert_eq!(invite.access_type, "invite");
        assert_eq!(invite.user_id.as_deref(), Some("usr_x"));

        let invite_plus = parse_location("wrld_a:1~private(usr_x)~canRequestInvite");
        assert_eq!(invite_plus.access_type, "invite+");
        assert!(invite_plus.can_request_invite);

        let friends = parse_location("wrld_a:1~friends(usr_y)");
        assert_eq!(friends.access_type, "friends");
        assert_eq!(friends.user_id.as_deref(), Some("usr_y"));

        let friends_plus = parse_location("wrld_a:1~hidden(usr_z)");
        assert_eq!(friends_plus.access_type, "friends+");
        assert_eq!(friends_plus.user_id.as_deref(), Some("usr_z"));
    }

    #[test]
    fn group_access_type_drives_name_and_normalization() {
        let plus = parse_location("wrld_a:1~group(grp_a)~groupAccessType(plus)");
        assert_eq!(plus.group_id.as_deref(), Some("grp_a"));
        assert_eq!(plus.access_type, "group");
        assert_eq!(plus.access_type_name, "groupPlus");
        assert_eq!(normalize_instance_type(&plus), "groupPlus");

        let public = parse_location("wrld_a:1~group(grp_a)~groupAccessType(public)");
        assert_eq!(public.access_type_name, "groupPublic");
        assert_eq!(normalize_instance_type(&public), "groupPublic");

        let members = parse_location("wrld_a:1~group(grp_a)~groupAccessType(members)");
        assert_eq!(members.access_type_name, "group");
        assert_eq!(normalize_instance_type(&members), "groupOnly");
    }

    #[test]
    fn strict_age_gate_and_short_name() {
        let parsed = parse_location("wrld_a:1~region(eu)~strict~ageGate&shortName=ab12");
        assert!(parsed.strict);
        assert!(parsed.age_gate);
        assert_eq!(parsed.short_name, "ab12");
        assert_eq!(parsed.instance_id, "1~region(eu)~strict~ageGate");
    }

    #[test]
    fn bare_world_id_without_instance() {
        let parsed = parse_location("wrld_only");
        assert_eq!(parsed.world_id, "wrld_only");
        assert_eq!(parsed.instance_id, "");
    }

    #[test]
    fn frontend_value_matches_presence_contract() {
        let parsed = parse_location("wrld_a:1~group(grp_a)~groupAccessType(plus)");
        assert_eq!(
            parsed.to_frontend_value("wrld_a:1~group(grp_a)~groupAccessType(plus)"),
            json!({
                "tag": "wrld_a:1~group(grp_a)~groupAccessType(plus)",
                "isOffline": false,
                "isPrivate": false,
                "isTraveling": false,
                "isRealInstance": true,
                "worldId": "wrld_a",
                "instanceId": "1~group(grp_a)~groupAccessType(plus)",
                "instanceName": "1",
                "accessType": "group",
                "accessTypeName": "groupPlus",
                "region": "",
                "shortName": "",
                "userId": null,
                "hiddenId": null,
                "privateId": null,
                "friendsId": null,
                "groupId": "grp_a",
                "groupAccessType": "plus",
                "canRequestInvite": false,
                "strict": false,
                "ageGate": false,
            })
        );

        let public = parse_location("wrld_a:1~region(use)");
        assert_eq!(
            public.to_frontend_value("wrld_a:1~region(use)")["region"],
            json!("use")
        );

        let strict = parse_location("wrld_a:1~region(eu)~strict~ageGate&shortName=ab12");
        assert_eq!(
            strict.to_frontend_value("wrld_a:1~region(eu)~strict~ageGate&shortName=ab12")
                ["shortName"],
            json!("ab12")
        );
        assert_eq!(
            strict.to_frontend_value("wrld_a:1~region(eu)~strict~ageGate&shortName=ab12")["strict"],
            json!(true)
        );
        assert_eq!(
            strict.to_frontend_value("wrld_a:1~region(eu)~strict~ageGate&shortName=ab12")
                ["ageGate"],
            json!(true)
        );

        let offline = parse_location("offline");
        assert_eq!(
            offline.to_frontend_value("  offline  "),
            json!({
                "tag": "  offline  ",
                "isOffline": true,
                "isPrivate": false,
                "isTraveling": false,
                "isRealInstance": false,
                "worldId": "",
                "instanceId": "",
                "instanceName": "",
                "accessType": "",
                "accessTypeName": "",
                "region": "",
                "shortName": "",
                "userId": null,
                "hiddenId": null,
                "privateId": null,
                "friendsId": null,
                "groupId": null,
                "groupAccessType": null,
                "canRequestInvite": false,
                "strict": false,
                "ageGate": false,
            })
        );
    }

    #[test]
    fn display_location_formats_sentinels_and_instance_access() {
        assert_eq!(
            format_display_location(&parse_location("offline"), "Ignored", ""),
            "Offline"
        );
        assert_eq!(
            format_display_location(&parse_location("private"), "Ignored", ""),
            "Private"
        );
        assert_eq!(
            format_display_location(&parse_location("traveling"), "Ignored", ""),
            "Traveling"
        );
        assert_eq!(
            format_display_location(
                &parse_location("wrld_a:1~group(grp_a)~groupAccessType(plus)"),
                "Group World",
                "Group Name",
            ),
            "Group World groupPlus(Group Name)"
        );
        assert_eq!(
            format_display_location(&parse_location("wrld_a:1~region(use)"), "Public World", ""),
            "Public World public"
        );
        assert_eq!(
            format_display_location(&parse_location("wrld_a:1"), "wrld_a", "grp_a"),
            "public"
        );
    }

    #[test]
    fn display_location_can_format_instance_access_with_labels() {
        let labels = DisplayLocationLabels {
            public: "Public",
            invite: "Invite",
            invite_plus: "Invite+",
            friends: "Friends",
            friends_plus: "Friends+",
            group: "Group",
            group_public: "Group Public",
            group_plus: "Group+",
        };

        assert_eq!(
            format_display_location_with_labels(
                &parse_location("wrld_a:1~group(grp_a)~groupAccessType(plus)"),
                "Group World",
                "Group Name",
                &labels,
            ),
            "Group World Group+(Group Name)"
        );
        assert_eq!(
            format_display_location_with_labels(
                &parse_location("wrld_a:1~friends(usr_a)"),
                "Friend World",
                "",
                &labels,
            ),
            "Friend World Friends"
        );
        assert_eq!(
            format_display_location_with_labels(
                &parse_location("wrld_a:1~hidden(usr_a)"),
                "Plus World",
                "",
                &labels,
            ),
            "Plus World Friends+"
        );
    }
}
