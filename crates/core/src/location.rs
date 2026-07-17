//! Canonical VRChat location-tag parser.
//!
//! A VRChat location tag looks like
//! `wrld_<id>:<instanceName>~<segment>~<segment>...&shortName=<code>` (plus the
//! sentinels `offline` / `private` / `traveling`). This module is the single
//! source of truth for turning that string into structured data; every realtime,
//! presence, and Discord path consumes it instead of re-implementing parsing.

use serde::Serialize;
use serde_json::{json, Value};

use crate::vrchat_endpoints::VRCHAT_SITE_ORIGIN;

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

pub fn world_id_from_location(tag: &str) -> String {
    let trimmed = tag.trim();
    if !trimmed.starts_with("wrld_") {
        return String::new();
    }
    trimmed
        .split([':', '~'])
        .next()
        .unwrap_or_default()
        .to_string()
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
    format_display_location_with_instance(parsed, world_name, group_name, false)
}

pub fn format_display_location_with_instance(
    parsed: &ParsedLocation,
    world_name: &str,
    group_name: &str,
    show_instance_id: bool,
) -> String {
    format_display_location_parts(
        parsed,
        world_name,
        group_name,
        parsed.access_type_name.as_str(),
        show_instance_id,
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
    format_display_location_with_labels_and_instance(parsed, world_name, group_name, labels, false)
}

pub fn format_display_location_with_labels_and_instance(
    parsed: &ParsedLocation,
    world_name: &str,
    group_name: &str,
    labels: &DisplayLocationLabels<'_>,
    show_instance_id: bool,
) -> String {
    format_display_location_parts(
        parsed,
        world_name,
        group_name,
        access_type_label(parsed, labels),
        show_instance_id,
    )
}

pub fn access_type_label<'a>(
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

pub fn launch_url(parsed: &ParsedLocation) -> String {
    if parsed.world_id.is_empty() || parsed.instance_id.is_empty() {
        return String::new();
    }
    let mut url = format!(
        "{VRCHAT_SITE_ORIGIN}/home/launch?worldId={}&instanceId={}",
        parsed.world_id, parsed.instance_id
    );
    if !parsed.short_name.is_empty() {
        url.push_str("&shortName=");
        url.push_str(&parsed.short_name);
    }
    url
}

pub fn region_label(region: &str) -> String {
    region.trim().to_ascii_uppercase()
}

fn format_display_location_parts(
    parsed: &ParsedLocation,
    world_name: &str,
    group_name: &str,
    access_type_name: &str,
    show_instance_id: bool,
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
    let instance_suffix = if show_instance_id && !parsed.instance_name.is_empty() {
        format!(" #{}", parsed.instance_name)
    } else {
        String::new()
    };
    if !parsed.world_id.is_empty() {
        if !group_name.is_empty() {
            return format!("{world_name} {access_type_name}({group_name}){instance_suffix}")
                .trim()
                .to_string();
        }
        if !parsed.instance_id.is_empty() {
            return format!("{world_name} {access_type_name}{instance_suffix}")
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
mod tests;
