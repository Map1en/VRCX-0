use std::hash::{DefaultHasher, Hash, Hasher};
use std::io::Write;
use std::path::Path;
use std::sync::Mutex;

use serde_json::{json, Value};
use vrcx_0_vrchat_client::http_api::{ApiScope, HttpApiRequestInput};

const MAX_ENTRIES: usize = 200;
static WRITTEN: Mutex<usize> = Mutex::new(0);

pub(crate) fn request_context(input: &HttpApiRequestInput, scope: ApiScope) -> Option<Value> {
    if scope != ApiScope::Vrchat {
        return None;
    }
    let path = input.path.as_deref()?;
    let route = match path {
        "auth/user" => "auth/user",
        "auth/user/friends" => "auth/user/friends",
        "users" => "users",
        _ => {
            let (resource, user_id) = path.split_once('/')?;
            if !(user_id.starts_with("usr_") || user_id.starts_with("usr%5F"))
                || user_id.contains('/')
            {
                return None;
            }
            match resource {
                "users" => "users/{id}",
                "profile" => "profile/{id}",
                _ => return None,
            }
        }
    };
    Some(json!({
        "route": route,
        "method": input.method.as_deref().unwrap_or("GET"),
        "asSelf": input.query_params.as_ref().and_then(|params| params.get("asSelf")).and_then(Value::as_bool),
    }))
}

fn field_shape(value: Option<&Value>) -> Value {
    match value {
        None => json!({ "type": "missing" }),
        Some(Value::Null) => json!({ "type": "null" }),
        Some(Value::String(value)) => json!({ "type": "string", "empty": value.is_empty() }),
        Some(Value::Array(value)) => json!({ "type": "array", "length": value.len() }),
        Some(Value::Object(_)) => json!({ "type": "object" }),
        Some(Value::Bool(_)) => json!({ "type": "boolean" }),
        Some(Value::Number(_)) => json!({ "type": "number" }),
    }
}

fn user_shape(user: &Value) -> Value {
    let user_key = user.get("id").and_then(Value::as_str).map(|id| {
        let mut hash = DefaultHasher::new();
        id.hash(&mut hash);
        format!("{:016x}", hash.finish())
    });
    let fields: serde_json::Map<String, Value> = [
        "iconUrl",
        "userIcon",
        "profilePicOverride",
        "profilePicOverrideThumbnail",
        "thumbnailUrl",
        "currentAvatarImageUrl",
        "currentAvatarThumbnailImageUrl",
        "bio",
        "bioLinks",
        "pronouns",
        "badges",
        "iconFrame",
        "iconType",
        "bannerUrl",
        "bannerCustomUrl",
        "bannerType",
        "hasVrcPlus",
        "tags",
        "trustTags",
    ]
    .into_iter()
    .map(|key| (key.to_string(), field_shape(user.get(key))))
    .collect();
    json!({
        "userKey": user_key,
        "mediaTypes": {
            "iconType": user.get("iconType").and_then(Value::as_str),
            "bannerType": user.get("bannerType").and_then(Value::as_str),
        },
        "shape": field_shape(Some(user)),
        "keys": user.as_object().map(|object| object.keys().collect::<Vec<_>>()),
        "fields": fields,
    })
}

pub(crate) fn diagnostics_path(app_data_dir: &Path) -> std::path::PathBuf {
    app_data_dir
        .join("diagnostics")
        .join("user-api-fields.jsonl")
}

pub(crate) async fn record(app_data_dir: &Path, mut context: Value, status: i32, data: &str) {
    let Ok(payload) = serde_json::from_str::<Value>(data) else {
        return;
    };
    context["at"] = json!(chrono::Utc::now().to_rfc3339());
    context["status"] = json!(status);
    context["payload"] = field_shape(Some(&payload));
    context["samples"] = match &payload {
        Value::Array(users) => users.iter().take(3).map(user_shape).collect(),
        _ => vec![user_shape(&payload)],
    }
    .into();
    let path = diagnostics_path(app_data_dir);
    let result = tokio::task::spawn_blocking(move || -> std::io::Result<()> {
        let mut written = WRITTEN
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if *written >= MAX_ENTRIES {
            return Ok(());
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(*written == 0)
            .append(*written > 0)
            .open(path)?;
        writeln!(file, "{context}")?;
        *written += 1;
        Ok(())
    })
    .await;
    match result {
        Ok(Ok(())) => {}
        Ok(Err(error)) => tracing::warn!(%error, "failed to write user API field diagnostics"),
        Err(error) => tracing::warn!(%error, "user API field diagnostics task failed"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_field_shapes_without_profile_values() {
        let shape = user_shape(&json!({
            "id": "usr_private", "displayName": "Private name", "bio": "private bio",
            "iconUrl": "https://private.example/icon", "bioLinks": [], "pronouns": null,
            "authToken": "secret", "iconType": "userIcon", "bannerType": "customImage"
        }));
        assert_eq!(
            shape["fields"]["bio"],
            json!({ "type": "string", "empty": false })
        );
        assert_eq!(
            shape["fields"]["bioLinks"],
            json!({ "type": "array", "length": 0 })
        );
        assert_eq!(shape["fields"]["pronouns"]["type"], "null");
        assert_eq!(shape["fields"]["badges"]["type"], "missing");
        assert_eq!(shape["mediaTypes"]["iconType"], "userIcon");
        assert_eq!(shape["mediaTypes"]["bannerType"], "customImage");
        let output = shape.to_string();
        for secret in [
            "usr_private",
            "Private name",
            "private bio",
            "https://private.example/icon",
            "secret",
        ] {
            assert!(!output.contains(secret));
        }
    }

    #[test]
    fn limits_capture_to_user_routes_and_redacts_the_target_id() {
        let mut input = HttpApiRequestInput {
            path: Some("profile/usr%5Fprivate".into()),
            query_params: Some(std::collections::HashMap::from([(
                "asSelf".into(),
                json!(true),
            )])),
            ..Default::default()
        };
        let context = request_context(&input, ApiScope::Vrchat).unwrap();
        assert_eq!(context["route"], "profile/{id}");
        assert_eq!(context["asSelf"], true);
        assert!(!context.to_string().contains("usr_private"));
        for path in [
            "users/usr_private/badges/bdg_private",
            "auth/twofactorauth/totp/verify",
            "auth/cookie",
        ] {
            input.path = Some(path.into());
            assert!(request_context(&input, ApiScope::Vrchat).is_none());
        }
    }

    #[test]
    fn diagnostics_path_is_under_the_local_profile_directory() {
        let path = diagnostics_path(Path::new(r"C:\Users\tester\AppData\Roaming\VRCX-0"));
        assert_eq!(
            path,
            Path::new(r"C:\Users\tester\AppData\Roaming\VRCX-0")
                .join("diagnostics")
                .join("user-api-fields.jsonl")
        );
        assert!(!path.to_string_lossy().starts_with("remote:"));
    }
}
