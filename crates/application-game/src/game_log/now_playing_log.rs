use serde_json::Value;
use vrcx_0_core::json::JsonExt;

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct NowPlayingLogEvent {
    pub producer_id: String,
    pub kind: NowPlayingLogKind,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum NowPlayingLogKind {
    Change {
        url: String,
        media_id: String,
        name: String,
        image: String,
        owner: String,
        length: i64,
    },
    Info {
        name: String,
        image: String,
    },
    Play {
        position: i64,
    },
    Pause {
        position: i64,
    },
    Seek {
        position: i64,
    },
    Stop,
    Other,
}

pub(crate) fn parse_now_playing_log(data: &str) -> Option<NowPlayingLogEvent> {
    let json: Value = serde_json::from_str(data).ok()?;
    let producer_id = json.trimmed_text("id");
    if producer_id.is_empty() {
        return None;
    }
    let seconds = |key: &str| {
        json.get(key)
            .and_then(Value::as_f64)
            .filter(|value| value.is_finite() && *value >= 0.0)
            .map(|value| value as i64)
    };
    let kind = match json.get("type")?.as_str()? {
        "mediaChange" => NowPlayingLogKind::Change {
            url: json.trimmed_text("mediaUrl"),
            media_id: json.scalar_field("mediaId").unwrap_or_default(),
            name: json.trimmed_text("mediaName"),
            image: json.trimmed_text("mediaImage"),
            owner: json.trimmed_text("mediaOwnerName"),
            length: seconds("mediaLength").unwrap_or(0),
        },
        "mediaInfo" => NowPlayingLogKind::Info {
            name: json.trimmed_text("mediaName"),
            image: json.trimmed_text("mediaImage"),
        },
        "mediaPlay" => NowPlayingLogKind::Play {
            position: seconds("mediaTime")?,
        },
        "mediaPause" => NowPlayingLogKind::Pause {
            position: seconds("mediaTime")?,
        },
        "mediaSeek" => NowPlayingLogKind::Seek {
            position: seconds("mediaTime")?,
        },
        "mediaStop" => NowPlayingLogKind::Stop,
        _ => NowPlayingLogKind::Other,
    };
    Some(NowPlayingLogEvent { producer_id, kind })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kind(data: &str) -> Option<NowPlayingLogKind> {
        parse_now_playing_log(data).map(|event| event.kind)
    }

    #[test]
    fn reads_the_events_vrcx_follows() {
        assert_eq!(
            parse_now_playing_log(
                r#"{"id":"ProTV-1","type":"mediaChange","mediaUrl":"https://youtu.be/abc","mediaName":"Song","mediaImage":"https://img.test/a.jpg","mediaOwnerName":"Alice","mediaLength":212.7,"mediaId":4480}"#
            ),
            Some(NowPlayingLogEvent {
                producer_id: "ProTV-1".into(),
                kind: NowPlayingLogKind::Change {
                    url: "https://youtu.be/abc".into(),
                    media_id: "4480".into(),
                    name: "Song".into(),
                    image: "https://img.test/a.jpg".into(),
                    owner: "Alice".into(),
                    length: 212,
                },
            })
        );
        assert_eq!(
            kind(r#"{"id":"ProTV-1","type":"mediaPause","mediaTime":12.5}"#),
            Some(NowPlayingLogKind::Pause { position: 12 })
        );
        assert_eq!(
            kind(r#"{"id":"ProTV-1","type":"mediaInfo","mediaName":"Song"}"#),
            Some(NowPlayingLogKind::Info {
                name: "Song".into(),
                image: String::new()
            })
        );
        assert_eq!(
            kind(r#"{"id":"ProTV-1","type":"mediaStop","ended":true}"#),
            Some(NowPlayingLogKind::Stop)
        );
        assert_eq!(
            kind(r#"{"id":"ProTV-1","type":"mediaLoading","loading":true}"#),
            Some(NowPlayingLogKind::Other)
        );
    }

    #[test]
    fn rejects_events_without_a_producer_or_a_position() {
        assert_eq!(kind(r#"{"type":"mediaPlay","mediaTime":1}"#), None);
        assert_eq!(kind(r#"{"id":"ProTV-1","type":"mediaPlay"}"#), None);
        assert_eq!(kind("not json"), None);
    }
}
