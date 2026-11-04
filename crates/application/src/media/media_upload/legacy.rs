use std::time::Duration;

use serde_json::{json, Map, Value};
use vrcx_0_application_core::{Error, Result};
use vrcx_0_contracts::vrchat_api::vrchat_response;
use vrcx_0_contracts::vrchat_api::VrchatResponse;
use vrcx_0_core::files::extract_file_id;
use vrcx_0_core::json::JsonExt;

use super::{
    LegacyEntityImageKind, LegacyEntityImageUploadInput, LegacyMediaUploadDeps,
    LegacyMediaUploadGate, LegacyMediaUploadGateFuture, LegacyMediaUploadRequest,
};

const LEGACY_MEDIA_REMOTE_MUTATION_INTERVAL: Duration = Duration::from_millis(250);

struct LegacyEntityImageTarget {
    entity_label: &'static str,
    entity_output_key: &'static str,
}

struct LegacyMediaMutationGate<'a> {
    mutation: &'a vrcx_0_application_core::AuthenticatedMutationContext<'a>,
}

impl LegacyMediaUploadGate for LegacyMediaMutationGate<'_> {
    fn before_request(&self) -> LegacyMediaUploadGateFuture<'_> {
        Box::pin(
            self.mutation
                .wait_for_remote(LEGACY_MEDIA_REMOTE_MUTATION_INTERVAL),
        )
    }

    fn after_request(&self) -> Result<()> {
        self.mutation.ensure_current()
    }
}

fn legacy_entity_image_target(kind: LegacyEntityImageKind) -> LegacyEntityImageTarget {
    match kind {
        LegacyEntityImageKind::Avatar => LegacyEntityImageTarget {
            entity_label: "Avatar",
            entity_output_key: "avatar",
        },
        LegacyEntityImageKind::World => LegacyEntityImageTarget {
            entity_label: "World",
            entity_output_key: "world",
        },
    }
}

pub async fn upload_legacy_entity_image(
    deps: LegacyMediaUploadDeps<'_>,
    input: LegacyEntityImageUploadInput,
    kind: LegacyEntityImageKind,
) -> Result<VrchatResponse> {
    let target = legacy_entity_image_target(kind);
    let entity_id = require_text(
        input.entity_id,
        &format!(
            "VrchatMediaLegacyImageUpload requires {} id.",
            target.entity_label
        ),
    )?;
    let source_file_id = extract_file_id(&input.image_url).unwrap_or_default();
    if source_file_id.is_empty() {
        return Err(Error::Custom(format!(
            "{} image upload requires an existing source image file id.",
            target.entity_label
        )));
    }
    if input.base64_file.trim().is_empty() {
        return Err(Error::Custom(format!(
            "{} image upload requires image data.",
            target.entity_label
        )));
    }

    let request = LegacyMediaUploadRequest {
        endpoint: deps.mutation.scope().endpoint.clone(),
        entity_id,
        source_file_id,
        base64_file: input.base64_file,
        file_size_in_bytes: input.file_size_in_bytes,
        kind,
    };
    let gate = LegacyMediaMutationGate {
        mutation: &deps.mutation,
    };
    let result = deps.port.upload(request, &gate).await?;

    if result.entity.as_value().text_field("imageUrl") != result.image_url {
        return Err(Error::Custom(format!(
            "{} image change failed.",
            target.entity_label
        )));
    }

    let mut payload = Map::new();
    payload.insert(
        target.entity_output_key.to_string(),
        result.entity.into_value(),
    );
    payload.insert("imageUrl".into(), Value::String(result.image_url));
    payload.insert("fileId".into(), Value::String(result.file_id));
    payload.insert("fileVersion".into(), json!(result.file_version));
    Ok(vrchat_response(200, Value::Object(payload).to_string()))
}

fn require_text(value: impl AsRef<str>, message: &str) -> Result<String> {
    let value = value.as_ref().trim().to_string();
    if value.is_empty() {
        Err(Error::Custom(message.to_string()))
    } else {
        Ok(value)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use serde_json::json;
    use vrcx_0_application_core::{
        AuthenticatedMutationContext, RemoteMutationGate, RuntimeAuthScope,
    };

    use super::*;
    use crate::media::{LegacyMediaUploadFuture, LegacyMediaUploadPort, LegacyMediaUploadResult};

    struct FakeUploadPort {
        requests: Mutex<Vec<LegacyMediaUploadRequest>>,
        result: LegacyMediaUploadResult,
    }

    impl LegacyMediaUploadPort for FakeUploadPort {
        fn upload<'a>(
            &'a self,
            request: LegacyMediaUploadRequest,
            gate: &'a dyn LegacyMediaUploadGate,
        ) -> LegacyMediaUploadFuture<'a> {
            self.requests
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .push(request);
            let result = self.result.clone();
            Box::pin(async move {
                gate.before_request().await?;
                gate.after_request()?;
                Ok(result)
            })
        }
    }

    fn auth_scope() -> RuntimeAuthScope {
        let scope = RuntimeAuthScope::new();
        scope.set("usr_self", "https://api.example.test/api/1");
        scope
    }

    fn input(entity_id: &str, image_url: &str, base64_file: &str) -> LegacyEntityImageUploadInput {
        LegacyEntityImageUploadInput {
            entity_id: entity_id.into(),
            image_url: image_url.into(),
            base64_file: base64_file.into(),
            file_size_in_bytes: Some(123),
        }
    }

    #[tokio::test]
    async fn preserves_legacy_avatar_response_and_port_request_contract() {
        let port = FakeUploadPort {
            requests: Mutex::new(Vec::new()),
            result: LegacyMediaUploadResult {
                entity: json!({ "id": "avtr_1", "imageUrl": "https://media/file/file_new/2/file" })
                    .into(),
                image_url: "https://media/file/file_new/2/file".into(),
                file_id: "file_new".into(),
                file_version: 2,
            },
        };
        let auth_scope = auth_scope();
        let gate = RemoteMutationGate::default();
        let mutation =
            AuthenticatedMutationContext::capture(&auth_scope, &gate, "Legacy media mutation")
                .unwrap();

        let response = upload_legacy_entity_image(
            LegacyMediaUploadDeps::new(&port, mutation),
            input(
                " avtr_1 ",
                "https://media/file/file_source/1/file",
                "encoded",
            ),
            LegacyEntityImageKind::Avatar,
        )
        .await
        .unwrap();

        assert_eq!(response.status, 200);
        assert_eq!(
            serde_json::from_str::<Value>(&response.data).unwrap(),
            json!({
                "avatar": { "id": "avtr_1", "imageUrl": "https://media/file/file_new/2/file" },
                "imageUrl": "https://media/file/file_new/2/file",
                "fileId": "file_new",
                "fileVersion": 2,
            })
        );
        let requests = port
            .requests
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].endpoint, "https://api.example.test/api/1");
        assert_eq!(requests[0].entity_id, "avtr_1");
        assert_eq!(requests[0].source_file_id, "file_source");
        assert_eq!(requests[0].file_size_in_bytes, Some(123));
        assert_eq!(requests[0].kind, LegacyEntityImageKind::Avatar);
    }

    #[tokio::test]
    async fn rejects_invalid_inputs_before_invoking_the_port() {
        let cases = [
            (
                input(" ", "https://media/file/file_source/1/file", "encoded"),
                "requires Avatar id",
            ),
            (
                input("avtr_1", "missing", "encoded"),
                "source image file id",
            ),
            (
                input("avtr_1", "https://media/file/file_source/1/file", " "),
                "requires image data",
            ),
        ];
        for (input, expected) in cases {
            let port = FakeUploadPort {
                requests: Mutex::new(Vec::new()),
                result: LegacyMediaUploadResult {
                    entity: Value::Null.into(),
                    image_url: String::new(),
                    file_id: String::new(),
                    file_version: 0,
                },
            };
            let auth_scope = auth_scope();
            let gate = RemoteMutationGate::default();
            let mutation =
                AuthenticatedMutationContext::capture(&auth_scope, &gate, "Legacy media mutation")
                    .unwrap();
            let error = upload_legacy_entity_image(
                LegacyMediaUploadDeps::new(&port, mutation),
                input,
                LegacyEntityImageKind::Avatar,
            )
            .await
            .unwrap_err();
            assert!(error.to_string().contains(expected));
            assert!(port
                .requests
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .is_empty());
        }
    }

    struct ScopeSwitchingPort {
        auth_scope: RuntimeAuthScope,
        gate_calls: Mutex<usize>,
    }

    impl LegacyMediaUploadPort for ScopeSwitchingPort {
        fn upload<'a>(
            &'a self,
            _request: LegacyMediaUploadRequest,
            gate: &'a dyn LegacyMediaUploadGate,
        ) -> LegacyMediaUploadFuture<'a> {
            Box::pin(async move {
                gate.before_request().await?;
                *self
                    .gate_calls
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner()) += 1;
                gate.after_request()?;
                self.auth_scope
                    .set("usr_other", "https://api.example.test/api/1");
                gate.before_request().await?;
                *self
                    .gate_calls
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner()) += 1;
                gate.after_request()?;
                unreachable!("second request should be rejected by the gate")
            })
        }
    }

    #[tokio::test]
    async fn every_upload_request_is_gated_so_a_mid_chain_account_switch_aborts() {
        let auth_scope = auth_scope();
        let port = ScopeSwitchingPort {
            auth_scope: auth_scope.clone(),
            gate_calls: Mutex::new(0),
        };
        let gate = RemoteMutationGate::default();
        let mutation =
            AuthenticatedMutationContext::capture(&auth_scope, &gate, "Legacy media mutation")
                .unwrap();

        let error = upload_legacy_entity_image(
            LegacyMediaUploadDeps::new(&port, mutation),
            input("avtr_1", "https://media/file/file_source/1/file", "encoded"),
            LegacyEntityImageKind::Avatar,
        )
        .await
        .unwrap_err();

        assert!(error
            .to_string()
            .contains("Legacy media mutation authentication scope changed."));
        assert_eq!(
            *port
                .gate_calls
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()),
            1
        );
    }
}
