use futures_util::future::BoxFuture;

use serde::{Deserialize, Serialize};
use vrcx_0_application_core::{ConfigStore, Error, Result};

pub use vrcx_0_contracts::TranslationProvider;

const KEY_ENABLED: &str = "translationAPI";
const KEY_BIO_LANGUAGE: &str = "bioLanguage";
const KEY_API_TYPE: &str = "translationAPIType";
const KEY_API_KEY: &str = "translationAPIKey";
const KEY_ENDPOINT_ID: &str = "translationEndpointId";
const KEY_MODEL: &str = "translationAPIModel";
const KEY_PROMPT: &str = "translationAPIPrompt";
const KEY_REASONING_EFFORT: &str = "translationAPIReasoningEffort";

pub const DEFAULT_TRANSLATION_MODEL: &str = "gpt-4o-mini";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StandardTranslationOutcome {
    pub text: String,
    pub detected_source_language: Option<String>,
}

pub type StandardTranslationFuture<'a> = BoxFuture<'a, Result<StandardTranslationOutcome>>;

pub trait StandardTranslationPort: Send + Sync {
    fn translate(
        &self,
        provider: TranslationProvider,
        key: String,
        text: String,
        target_language: String,
    ) -> StandardTranslationFuture<'_>;
}

#[derive(Clone, Copy)]
pub struct TranslationDeps<'a> {
    pub config: &'a dyn ConfigStore,
    pub standard_translation: &'a dyn StandardTranslationPort,
}

#[derive(Clone, Debug, Default, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TranslationOverrides {
    pub enabled: Option<bool>,
    pub api_type: Option<TranslationProvider>,
    pub key: Option<String>,
    pub endpoint_id: Option<String>,
    pub model: Option<String>,
    pub prompt: Option<String>,
    pub reasoning_effort: Option<String>,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TranslationTranslateInput {
    pub text: String,
    pub target_language: Option<String>,
    pub overrides: Option<TranslationOverrides>,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TranslationResult {
    pub text: String,
    pub detected_source_language: Option<String>,
    pub provider: TranslationProvider,
}

#[derive(Clone, Debug)]
pub struct OpenAiTranslationRequest {
    pub endpoint_id: String,
    pub model: String,
    pub prompt: Option<String>,
    pub reasoning_effort: Option<String>,
    pub target_language: String,
    pub text: String,
}

pub enum TranslationDispatch {
    Completed(TranslationResult),
    OpenAi(OpenAiTranslationRequest),
}

pub type OpenAiTranslationFuture<'a, E> = BoxFuture<'a, std::result::Result<String, E>>;

pub trait OpenAiTranslationPort: Send + Sync {
    type Error;

    fn resolve_default_endpoint_id(&self) -> OpenAiTranslationFuture<'_, Self::Error>;

    fn translate(
        &self,
        request: OpenAiTranslationRequest,
    ) -> OpenAiTranslationFuture<'_, Self::Error>;
}

#[derive(Debug)]
pub enum TranslationCompletionError<E> {
    Application(Error),
    Port(E),
}

pub async fn complete_translation<E>(
    dispatch: TranslationDispatch,
    port: &dyn OpenAiTranslationPort<Error = E>,
) -> std::result::Result<TranslationResult, TranslationCompletionError<E>> {
    let mut request = match dispatch {
        TranslationDispatch::Completed(result) => return Ok(result),
        TranslationDispatch::OpenAi(request) => request,
    };
    if request.endpoint_id.is_empty() {
        request.endpoint_id = port
            .resolve_default_endpoint_id()
            .await
            .map_err(TranslationCompletionError::Port)?;
    }
    if request.endpoint_id.is_empty() || request.model.is_empty() {
        return Err(TranslationCompletionError::Application(Error::Custom(
            "Translation endpoint/model missing.".into(),
        )));
    }
    let text = port
        .translate(request)
        .await
        .map_err(TranslationCompletionError::Port)?;
    Ok(TranslationResult {
        text,
        detected_source_language: None,
        provider: TranslationProvider::OpenAi,
    })
}

pub fn resolved_openai_translation_endpoint_id(config: &dyn ConfigStore) -> Result<String> {
    Ok(config.get_string(KEY_ENDPOINT_ID, "")?.trim().to_string())
}

fn override_or_config(
    config: &dyn ConfigStore,
    value: Option<&String>,
    key: &str,
    default: &str,
) -> Result<String> {
    match value {
        Some(value) => Ok(value.clone()),
        None => config.get_string(key, default),
    }
}

pub async fn translate_text(
    deps: TranslationDeps<'_>,
    input: TranslationTranslateInput,
) -> Result<TranslationDispatch> {
    let overrides = input.overrides.unwrap_or_default();
    let enabled = match overrides.enabled {
        Some(enabled) => enabled,
        None => deps.config.get_bool(KEY_ENABLED, false)?,
    };
    if !enabled {
        return Err(Error::Custom("Translation API disabled.".into()));
    }

    let bio_language = deps.config.get_string(KEY_BIO_LANGUAGE, "en")?;
    let target_language = input
        .target_language
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(bio_language);
    let target_language = if target_language.trim().is_empty() {
        "en".to_string()
    } else {
        target_language
    };
    let provider = match overrides.api_type {
        Some(provider) => provider,
        None => parse_translation_provider(&deps.config.get_string(KEY_API_TYPE, "google")?),
    };

    match provider {
        TranslationProvider::OpenAi => {
            let endpoint_id = match overrides.endpoint_id {
                Some(endpoint_id) => endpoint_id.trim().to_string(),
                None => resolved_openai_translation_endpoint_id(deps.config)?,
            };
            let model = {
                let model = override_or_config(
                    deps.config,
                    overrides.model.as_ref(),
                    KEY_MODEL,
                    DEFAULT_TRANSLATION_MODEL,
                )?;
                let model = model.trim().to_string();
                if model.is_empty() {
                    DEFAULT_TRANSLATION_MODEL.to_string()
                } else {
                    model
                }
            };
            let prompt =
                override_or_config(deps.config, overrides.prompt.as_ref(), KEY_PROMPT, "")?;
            let reasoning_effort = override_or_config(
                deps.config,
                overrides.reasoning_effort.as_ref(),
                KEY_REASONING_EFFORT,
                "",
            )?;
            Ok(TranslationDispatch::OpenAi(OpenAiTranslationRequest {
                endpoint_id,
                model,
                prompt: Some(prompt).filter(|value| !value.is_empty()),
                reasoning_effort: Some(reasoning_effort).filter(|value| !value.is_empty()),
                target_language,
                text: input.text,
            }))
        }
        TranslationProvider::Google | TranslationProvider::DeepL => {
            let key = override_or_config(deps.config, overrides.key.as_ref(), KEY_API_KEY, "")?;
            if key.is_empty() {
                return Err(Error::Custom("No Translation API key configured.".into()));
            }

            let outcome = deps
                .standard_translation
                .translate(provider, key, input.text, target_language)
                .await?;

            Ok(TranslationDispatch::Completed(TranslationResult {
                text: outcome.text,
                detected_source_language: outcome.detected_source_language,
                provider,
            }))
        }
    }
}

fn parse_translation_provider(value: &str) -> TranslationProvider {
    match value.trim().to_ascii_lowercase().as_str() {
        "deepl" => TranslationProvider::DeepL,
        "openai" => TranslationProvider::OpenAi,
        _ => TranslationProvider::Google,
    }
}

#[cfg(test)]
mod completion_tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    struct FakeOpenAiTranslationPort {
        resolves: AtomicUsize,
        translations: AtomicUsize,
        endpoint_id: String,
    }

    impl OpenAiTranslationPort for FakeOpenAiTranslationPort {
        type Error = String;

        fn resolve_default_endpoint_id(&self) -> OpenAiTranslationFuture<'_, Self::Error> {
            self.resolves.fetch_add(1, Ordering::AcqRel);
            Box::pin(async { Ok(self.endpoint_id.clone()) })
        }

        fn translate(
            &self,
            request: OpenAiTranslationRequest,
        ) -> OpenAiTranslationFuture<'_, Self::Error> {
            self.translations.fetch_add(1, Ordering::AcqRel);
            Box::pin(async move { Ok(format!("{}:{}", request.endpoint_id, request.text)) })
        }
    }

    fn fake_port(endpoint_id: &str) -> FakeOpenAiTranslationPort {
        FakeOpenAiTranslationPort {
            resolves: AtomicUsize::new(0),
            translations: AtomicUsize::new(0),
            endpoint_id: endpoint_id.into(),
        }
    }

    #[tokio::test]
    async fn completed_translation_does_not_touch_the_openai_port() {
        let port = fake_port("endpoint");
        let result = complete_translation(
            TranslationDispatch::Completed(TranslationResult {
                text: "done".into(),
                detected_source_language: Some("ja".into()),
                provider: TranslationProvider::Google,
            }),
            &port,
        )
        .await
        .unwrap();

        assert_eq!(result.text, "done");
        assert_eq!(result.detected_source_language.as_deref(), Some("ja"));
        assert_eq!(port.resolves.load(Ordering::Acquire), 0);
        assert_eq!(port.translations.load(Ordering::Acquire), 0);
    }

    #[tokio::test]
    async fn openai_translation_resolves_the_default_endpoint_before_dispatch() {
        let port = fake_port("endpoint");
        let result = complete_translation(
            TranslationDispatch::OpenAi(OpenAiTranslationRequest {
                endpoint_id: String::new(),
                model: "model".into(),
                prompt: None,
                reasoning_effort: None,
                target_language: "en".into(),
                text: "hello".into(),
            }),
            &port,
        )
        .await
        .unwrap();

        assert_eq!(result.text, "endpoint:hello");
        assert_eq!(result.detected_source_language, None);
        assert_eq!(result.provider, TranslationProvider::OpenAi);
        assert_eq!(port.resolves.load(Ordering::Acquire), 1);
        assert_eq!(port.translations.load(Ordering::Acquire), 1);
    }

    #[tokio::test]
    async fn openai_translation_keeps_the_missing_endpoint_error_contract() {
        let port = fake_port("");
        let error = complete_translation(
            TranslationDispatch::OpenAi(OpenAiTranslationRequest {
                endpoint_id: String::new(),
                model: "model".into(),
                prompt: None,
                reasoning_effort: None,
                target_language: "en".into(),
                text: "hello".into(),
            }),
            &port,
        )
        .await
        .unwrap_err();

        assert!(matches!(
            error,
            TranslationCompletionError::Application(Error::Custom(message))
                if message == "Translation endpoint/model missing."
        ));
        assert_eq!(port.translations.load(Ordering::Acquire), 0);
    }
}
