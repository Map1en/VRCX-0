use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use vrcx_0_application::{
    OverlayActivityActorRelation, OverlayActivityCategory, OverlayActivityContent,
    OverlayActivityEntry, OverlayActivitySnapshot, OverlayActivityText,
};
use vrcx_0_host::vr_overlay::{VrDeviceSnapshot, VrDeviceStatus};
use vrcx_0_runtime_host::vr_overlay::{
    WristOverlayFrameInput, WristOverlayRenderOptions, WristOverlaySizePreset, WristRuntimeFooter,
};

const LOCALES: &[&str] = &["en", "zh-CN", "zh-TW", "ja", "ko"];
const SIZES: &[WristOverlaySizePreset] = &[
    WristOverlaySizePreset::Compact,
    WristOverlaySizePreset::Normal,
    WristOverlaySizePreset::Large,
];

#[derive(Clone, Debug)]
pub struct MockPreview {
    entries: Vec<OverlayActivityEntry>,
    next_sequence: u64,
    locale_index: usize,
    size_index: usize,
    dark_background: bool,
    show_devices: bool,
    show_battery_percent: bool,
}

impl MockPreview {
    pub fn new() -> Self {
        let mut preview = Self {
            entries: Vec::new(),
            next_sequence: 1,
            locale_index: 0,
            size_index: 1,
            dark_background: true,
            show_devices: true,
            show_battery_percent: true,
        };
        preview.inject(1);
        preview.inject(2);
        preview.inject(3);
        preview.inject(4);
        preview.inject(5);
        preview.inject(6);
        preview.inject(7);
        preview
    }

    pub fn frame_input(&self) -> WristOverlayFrameInput {
        WristOverlayFrameInput {
            activity: OverlayActivitySnapshot {
                entries: self.entries.clone(),
            },
            devices: mock_devices(),
            footer: WristRuntimeFooter {
                player_count: 12,
                instance_duration: "24m".to_string(),
                local_time: "12:34".to_string(),
            },
            options: WristOverlayRenderOptions {
                size: SIZES[self.size_index],
                hide_private_worlds: false,
                dark_background: self.dark_background,
                show_devices: self.show_devices,
                show_battery_percent: self.show_battery_percent,
            },
            locale: LOCALES[self.locale_index].to_string(),
            captured_at_ms: now_ms(),
        }
    }

    pub fn inject(&mut self, key: u32) {
        match key {
            1 => {
                self.push_entry(
                    "OnPlayerJoined",
                    OverlayActivityCategory::CurrentInstance,
                    "Ada",
                    localized_body("notifications.has_joined", json!({}), "has joined"),
                    EntryMeta {
                        actor_relation: OverlayActivityActorRelation::Favorite,
                        ..EntryMeta::default()
                    },
                );
                self.push_entry(
                    "OnPlayerJoined",
                    OverlayActivityCategory::CurrentInstance,
                    "Mika",
                    localized_body("notifications.has_joined", json!({}), "has joined"),
                    EntryMeta {
                        actor_relation: OverlayActivityActorRelation::Friend,
                        ..EntryMeta::default()
                    },
                );
                self.push_entry(
                    "OnPlayerJoined",
                    OverlayActivityCategory::CurrentInstance,
                    "Visitor 12",
                    localized_body("notifications.has_joined", json!({}), "has joined"),
                    EntryMeta::default(),
                );
            }
            2 => {
                self.push_entry(
                    "OnPlayerLeft",
                    OverlayActivityCategory::CurrentInstance,
                    "Mika",
                    localized_body("notifications.has_left", json!({}), "has left"),
                    EntryMeta {
                        actor_relation: OverlayActivityActorRelation::Friend,
                        ..EntryMeta::default()
                    },
                );
                self.push_entry(
                    "OnPlayerLeft",
                    OverlayActivityCategory::CurrentInstance,
                    "Visitor 27",
                    localized_body("notifications.has_left", json!({}), "has left"),
                    EntryMeta::default(),
                );
            }
            3 => {
                self.push_entry(
                    "Online",
                    OverlayActivityCategory::FavoriteMovement,
                    "Kuro",
                    localized_body(
                        "notifications.online_location",
                        json!({ "location": "wrld_mock" }),
                        "has logged in to wrld_mock",
                    ),
                    EntryMeta {
                        location: "wrld_mock:12345".to_string(),
                        world_name: "Preview World".to_string(),
                        actor_relation: OverlayActivityActorRelation::Favorite,
                        ..EntryMeta::default()
                    },
                );
                self.push_entry(
                    "Online",
                    OverlayActivityCategory::FavoriteMovement,
                    "Public Guest",
                    localized_body(
                        "notifications.online_location",
                        json!({ "location": "wrld_public" }),
                        "has logged in to wrld_public",
                    ),
                    EntryMeta {
                        location: "wrld_public:preview".to_string(),
                        world_name: "Public Test World".to_string(),
                        ..EntryMeta::default()
                    },
                );
            }
            4 => {
                self.push_entry(
                    "invite",
                    OverlayActivityCategory::ActionRequired,
                    "Rin",
                    localized_body(
                        "notifications.invite",
                        json!({
                            "location": "wrld_invite",
                            "message": "Join?",
                        }),
                        "has invited you to wrld_invite Join?",
                    ),
                    EntryMeta {
                        location: "wrld_invite:preview".to_string(),
                        world_name: "Invite Lab".to_string(),
                        actor_relation: OverlayActivityActorRelation::Friend,
                        ..EntryMeta::default()
                    },
                );
                self.push_entry(
                    "requestInvite",
                    OverlayActivityCategory::ActionRequired,
                    "Traveler",
                    localized_body(
                        "notifications.request_invite",
                        json!({ "message": "Can I join?" }),
                        "has requested an invite Can I join?",
                    ),
                    EntryMeta::default(),
                );
                self.push_entry(
                    "friendRequest",
                    OverlayActivityCategory::ActionRequired,
                    "New Person",
                    localized_body(
                        "notifications.friend_request",
                        json!({}),
                        "has sent you a friend request",
                    ),
                    EntryMeta::default(),
                );
            }
            5 => {
                self.push_entry(
                    "group.queueReady",
                    OverlayActivityCategory::ActionRequired,
                    "",
                    literal_body("Queue pop: Preview Group".to_string()),
                    EntryMeta {
                        title: localized_body(
                            "notifications.group_queue_ready_title",
                            json!({}),
                            "Instance Queue Ready",
                        ),
                        group_name: "Preview Group".to_string(),
                        ..EntryMeta::default()
                    },
                );
                self.push_entry(
                    "instance.closed",
                    OverlayActivityCategory::ActionRequired,
                    "",
                    literal_body("Instance closed by owner".to_string()),
                    EntryMeta {
                        title: literal_title("Instance Closed"),
                        ..EntryMeta::default()
                    },
                );
            }
            6 => {
                self.push_entry(
                    "VideoPlay",
                    OverlayActivityCategory::Media,
                    "",
                    literal_body("Now playing https://www.youtube.com/watch?v=preview".to_string()),
                    EntryMeta::default(),
                );
                self.push_entry(
                    "VideoPlay",
                    OverlayActivityCategory::Media,
                    "Desk DJ",
                    literal_body("started playing a preview video".to_string()),
                    EntryMeta::default(),
                );
            }
            7 => {
                self.push_entry(
                    "GPS",
                    OverlayActivityCategory::FavoriteMovement,
                    "Yui",
                    localized_body(
                        "notifications.gps",
                        json!({ "location": "wrld_private" }),
                        "is in wrld_private",
                    ),
                    EntryMeta {
                        location: "wrld_private:preview~private(usr_preview)".to_string(),
                        world_name: "Private Preview".to_string(),
                        actor_relation: OverlayActivityActorRelation::Favorite,
                        ..EntryMeta::default()
                    },
                );
                self.push_entry(
                    "AvatarChange",
                    OverlayActivityCategory::ProfileChange,
                    "Noa",
                    localized_body(
                        "notifications.avatar_change",
                        json!({ "avatar": "Debug Avatar" }),
                        "changed into avatar Debug Avatar",
                    ),
                    EntryMeta {
                        avatar_name: "Debug Avatar".to_string(),
                        actor_relation: OverlayActivityActorRelation::Friend,
                        ..EntryMeta::default()
                    },
                );
                self.push_entry(
                    "Status",
                    OverlayActivityCategory::FavoriteMovement,
                    "Solo Tester",
                    localized_body(
                        "notifications.status_update",
                        json!({ "status": "busy", "description": "recording" }),
                        "status is now busy recording",
                    ),
                    EntryMeta::default(),
                );
            }
            _ => {}
        }
    }

    fn push_entry(
        &mut self,
        activity_type: &str,
        category: OverlayActivityCategory,
        actor: &str,
        body: OverlayActivityText,
        meta: EntryMeta,
    ) {
        let entry = self.entry(activity_type, category, actor, body, meta);
        self.entries.push(entry);
        if self.entries.len() > 48 {
            self.entries.remove(0);
        }
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }

    pub fn cycle_locale(&mut self) {
        self.locale_index = (self.locale_index + 1) % LOCALES.len();
    }

    pub fn cycle_size(&mut self) {
        self.size_index = (self.size_index + 1) % SIZES.len();
    }

    pub fn toggle_dark_background(&mut self) {
        self.dark_background = !self.dark_background;
    }

    pub fn toggle_devices(&mut self) {
        self.show_devices = !self.show_devices;
    }

    pub fn toggle_battery_percent(&mut self) {
        self.show_battery_percent = !self.show_battery_percent;
    }

    pub fn status_text(&self) -> String {
        format!(
            "{} / {:?} / devices {} / battery {}",
            LOCALES[self.locale_index],
            SIZES[self.size_index],
            if self.show_devices { "on" } else { "off" },
            if self.show_battery_percent {
                "percent"
            } else {
                "icons"
            }
        )
    }

    fn entry(
        &mut self,
        activity_type: &str,
        category: OverlayActivityCategory,
        actor: &str,
        body: OverlayActivityText,
        meta: EntryMeta,
    ) -> OverlayActivityEntry {
        let sequence = self.next_sequence;
        self.next_sequence = self.next_sequence.saturating_add(1);
        let actor_relation = meta.actor_relation;
        let title = if meta.title.fallback.is_empty() && meta.title.key.is_empty() {
            literal_title(actor)
        } else {
            meta.title
        };
        let summary = join_non_empty([title.fallback.as_str(), body.fallback.as_str()]);
        OverlayActivityEntry {
            sequence,
            source_id: format!("mock:{activity_type}:{sequence}"),
            activity_type: activity_type.to_string(),
            category,
            created_at: format!("2026-06-03T12:{:02}:00.000Z", sequence % 60),
            actor_user_id: format!("usr_mock_{sequence}"),
            actor_display_name: actor.to_string(),
            content: OverlayActivityContent {
                icon: String::new(),
                title,
                body,
                summary,
                detail: String::new(),
                location: meta.location,
                world_name: meta.world_name,
                group_name: meta.group_name,
                status: String::new(),
                status_description: String::new(),
                avatar_name: meta.avatar_name,
                image_url: String::new(),
            },
            actor_relation,
            payload: Value::Null,
        }
    }
}

#[derive(Default)]
struct EntryMeta {
    title: OverlayActivityText,
    location: String,
    world_name: String,
    group_name: String,
    avatar_name: String,
    actor_relation: OverlayActivityActorRelation,
}

fn mock_devices() -> Vec<VrDeviceSnapshot> {
    let mut devices = vec![
        VrDeviceSnapshot {
            label: "HMD".to_string(),
            serial: Some("preview-hmd".to_string()),
            status: VrDeviceStatus::Normal,
            battery_percent: Some(92),
        },
        VrDeviceSnapshot {
            label: "L".to_string(),
            serial: Some("preview-left".to_string()),
            status: VrDeviceStatus::LowBattery,
            battery_percent: Some(28),
        },
        VrDeviceSnapshot {
            label: "R".to_string(),
            serial: Some("preview-right".to_string()),
            status: VrDeviceStatus::Charging,
            battery_percent: Some(67),
        },
    ];
    for index in 1..=11 {
        let (status, battery_percent) = match index {
            1 => (VrDeviceStatus::CriticalBattery, Some(9)),
            3 => (VrDeviceStatus::LowBattery, Some(21)),
            8 => (VrDeviceStatus::Disconnected, None),
            9 => (VrDeviceStatus::TrackingWarning, Some(48)),
            _ => (VrDeviceStatus::Normal, Some(80)),
        };
        devices.push(VrDeviceSnapshot {
            label: format!("T{index}"),
            serial: Some(format!("preview-tracker-{index}")),
            status,
            battery_percent,
        });
    }
    devices
}

fn literal_title(value: &str) -> OverlayActivityText {
    OverlayActivityText {
        key: String::new(),
        fallback: value.to_string(),
        params: json!({}),
    }
}

fn literal_body(value: String) -> OverlayActivityText {
    OverlayActivityText {
        key: String::new(),
        fallback: value,
        params: json!({}),
    }
}

fn localized_body(key: &str, params: Value, fallback: &str) -> OverlayActivityText {
    OverlayActivityText {
        key: key.to_string(),
        fallback: fallback.to_string(),
        params,
    }
}

fn join_non_empty<'a, I>(values: I) -> String
where
    I: IntoIterator<Item = &'a str>,
{
    values
        .into_iter()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or_default()
}
