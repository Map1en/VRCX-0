use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;
use vrcx_0_integrations::llm::{
    is_openrouter_base_url, ChatMessage, LlmClient, LlmEndpointDetectModelsResult,
    LlmModelReasoning, LlmRequestOptions,
};
use vrcx_0_persistence::config::ConfigRepository;

use crate::config::{deobfuscate_api_key, normalize_llm_base_url, obfuscate_api_key, PlaybookMode};
use crate::error::HarnessError;
use crate::session::random_hex;

mod migration;

const LLM_ENDPOINTS_CONFIG_KEY: &str = "llm.endpoints";
const LLM_FOLLOW_CUSTOM_PROXY_CONFIG_KEY: &str = "llm.followCustomProxy";
const ASSISTANT_LAST_SELECTION_CONFIG_KEY: &str = "assistant.lastSelection";
const LEGACY_MIGRATION_DONE_KEY: &str = "llm.endpoints.legacyMigrated";
const TRANSLATION_ENDPOINT_ID_CONFIG_KEY: &str = "translationEndpointId";
const TRANSLATION_API_TYPE_CONFIG_KEY: &str = "translationAPIType";
const TRANSLATION_API_ENDPOINT_CONFIG_KEY: &str = "translationAPIEndpoint";
const TRANSLATION_API_KEY_CONFIG_KEY: &str = "translationAPIKey";
const TRANSLATION_API_MODEL_CONFIG_KEY: &str = "translationAPIModel";
const ASSISTANT_REASONING_EFFORT_CONFIG_KEY: &str = "assistantReasoningEffort";
const DEFAULT_TRANSLATION_SYSTEM_PROMPT: &str =
    "You are a translation assistant. Translate the user message into {targetLang}. Only return the translated text.";

pub(crate) fn translation_system_prompt(custom: Option<&str>, target_lang: &str) -> String {
    custom
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_TRANSLATION_SYSTEM_PROMPT)
        .replace("{targetLang}", target_lang)
}

type LegacyAssistantSeed = (String, Option<String>, bool, PlaybookMode);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredLlmEndpoint {
    id: String,
    name: String,
    base_url: String,
    api_key: String,
    #[serde(default)]
    models: Vec<String>,
    #[serde(default)]
    model_reasoning: Vec<LlmModelReasoning>,
    #[serde(default)]
    last_detected_at: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ResolvedLlmEndpoint {
    pub base_url: String,
    pub api_key: String,
    pub model_reasoning: Vec<LlmModelReasoning>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LlmEndpointDto {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub has_key: bool,
    pub models: Vec<String>,
    pub model_reasoning: Vec<LlmModelReasoning>,
    pub last_detected_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LlmEndpointUpsertInput {
    pub id: Option<String>,
    pub name: String,
    pub base_url: String,
    pub api_key: Option<String>,
    pub models: Vec<String>,
    pub model_reasoning: Option<Vec<LlmModelReasoning>>,
}

#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LlmEndpointDetectModelsInput {
    pub id: Option<String>,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub persist: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AssistantRuntimeSelection {
    pub endpoint_id: Option<String>,
    pub model: Option<String>,
    pub allow_writes: bool,
    pub playbook_mode: PlaybookMode,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AssistantRuntimeStatus {
    pub has_any_endpoint: bool,
    pub last_selection: AssistantRuntimeSelection,
}

#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LlmTranslateInput {
    pub endpoint_id: String,
    pub model: String,
    pub text: String,
    pub target_lang: String,
    pub prompt: Option<String>,
    pub reasoning_effort: Option<String>,
}

impl Default for AssistantRuntimeSelection {
    fn default() -> Self {
        Self {
            endpoint_id: None,
            model: None,
            allow_writes: false,
            playbook_mode: PlaybookMode::Auto,
        }
    }
}

#[derive(Clone)]
pub struct EndpointStore {
    config: ConfigRepository,
    custom_proxy_url: Option<String>,
    // Serializes read-modify-write of the endpoints blob across concurrent writers.
    write_lock: Arc<Mutex<()>>,
    migrated: Arc<AtomicBool>,
}

impl EndpointStore {
    pub fn new(config: ConfigRepository, custom_proxy_url: Option<String>) -> Self {
        Self {
            config,
            custom_proxy_url,
            write_lock: Arc::new(Mutex::new(())),
            migrated: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn list(&self) -> Result<Vec<LlmEndpointDto>, HarnessError> {
        self.ensure_migrated()?;
        Ok(self.load_endpoints()?.into_iter().map(to_dto).collect())
    }

    pub fn upsert(&self, input: LlmEndpointUpsertInput) -> Result<LlmEndpointDto, HarnessError> {
        self.ensure_migrated()?;
        let _guard = self.write_lock.lock().unwrap();
        let mut endpoints = self.load_endpoints()?;
        let base_url = normalize_llm_base_url(&input.base_url);
        if base_url.is_empty() {
            return Err(HarnessError::InvalidEndpoint(
                "LLM endpoint base URL is required.".into(),
            ));
        }
        let models = normalize_models(input.models);
        let id = input
            .id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("ep_{}", random_hex()));
        let existing = endpoints.iter().find(|endpoint| endpoint.id == id).cloned();
        let api_key = match input.api_key {
            Some(value) => obfuscate_api_key(value.trim()),
            None => existing
                .as_ref()
                .filter(|endpoint| normalize_llm_base_url(&endpoint.base_url) == base_url)
                .map(|endpoint| endpoint.api_key.clone())
                .unwrap_or_default(),
        };
        let name = {
            let name = input.name.trim();
            if name.is_empty() {
                default_endpoint_name(&base_url)
            } else {
                name.to_string()
            }
        };

        let model_reasoning = match input.model_reasoning {
            Some(reasoning) => retain_reasoning_for_models(reasoning, &models),
            None => match &existing {
                Some(endpoint) if normalize_llm_base_url(&endpoint.base_url) == base_url => {
                    retain_reasoning_for_models(endpoint.model_reasoning.clone(), &models)
                }
                _ => Vec::new(),
            },
        };

        let endpoint = StoredLlmEndpoint {
            id: id.clone(),
            name,
            base_url,
            api_key,
            models,
            model_reasoning,
            last_detected_at: existing.and_then(|endpoint| endpoint.last_detected_at),
        };

        if let Some(existing) = endpoints.iter_mut().find(|endpoint| endpoint.id == id) {
            *existing = endpoint.clone();
        } else {
            endpoints.push(endpoint.clone());
        }
        self.save_endpoints(&endpoints)?;
        Ok(to_dto(endpoint))
    }

    pub fn delete(&self, id: &str) -> Result<(), HarnessError> {
        self.ensure_migrated()?;
        let _guard = self.write_lock.lock().unwrap();
        let mut endpoints = self.load_endpoints()?;
        let fallback_endpoint_id = endpoints
            .iter()
            .find(|endpoint| endpoint.id != id)
            .map(|endpoint| endpoint.id.clone())
            .unwrap_or_default();
        endpoints.retain(|endpoint| endpoint.id != id);
        self.save_endpoints(&endpoints)?;

        let mut selection = self.read_last_selection_raw()?;
        if selection.endpoint_id.as_deref() == Some(id) {
            selection.endpoint_id = None;
            selection.model = None;
            self.set_last_selection(&selection)?;
        }
        if self
            .config
            .get_string(TRANSLATION_ENDPOINT_ID_CONFIG_KEY, "")?
            .trim()
            == id
        {
            self.config
                .set_string(TRANSLATION_ENDPOINT_ID_CONFIG_KEY, &fallback_endpoint_id)?;
        }
        Ok(())
    }

    pub async fn detect_models(
        &self,
        input: LlmEndpointDetectModelsInput,
    ) -> Result<LlmEndpointDetectModelsResult, HarnessError> {
        self.ensure_migrated()?;
        let resolved = self.resolve_detect_target(&input)?;
        let client = self.llm_client(&resolved.base_url, &resolved.api_key, "")?;
        let result = client.list_models().await?;
        let models = normalize_models(result.models);
        let model_reasoning = normalize_model_reasoning(result.model_reasoning, &models);

        if input.persist.unwrap_or(true) {
            if let Some(id) = input
                .id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                let _guard = self.write_lock.lock().unwrap();
                let mut endpoints = self.load_endpoints()?;
                if let Some(endpoint) = endpoints.iter_mut().find(|endpoint| endpoint.id == id) {
                    endpoint.models = models.clone();
                    endpoint.model_reasoning = model_reasoning.clone();
                    endpoint.last_detected_at = Some(chrono::Utc::now().to_rfc3339());
                    self.save_endpoints(&endpoints)?;
                }
            }
        }

        Ok(LlmEndpointDetectModelsResult {
            models,
            model_reasoning,
        })
    }

    pub fn resolve(&self, id: &str) -> Result<ResolvedLlmEndpoint, HarnessError> {
        self.ensure_migrated()?;
        let value = self
            .config
            .get_json(LLM_ENDPOINTS_CONFIG_KEY, Value::Null)?;
        let endpoints: Vec<StoredLlmEndpoint> = serde_json::from_value(value).unwrap_or_default();
        let endpoint = endpoints
            .into_iter()
            .find(|endpoint| endpoint.id == id)
            .ok_or_else(|| HarnessError::EndpointRemoved(id.to_string()))?;
        Ok(resolve_endpoint(endpoint))
    }

    pub fn runtime_status(&self) -> Result<AssistantRuntimeStatus, HarnessError> {
        let endpoints = self.list()?;
        Ok(AssistantRuntimeStatus {
            has_any_endpoint: !endpoints.is_empty(),
            last_selection: self.last_selection()?,
        })
    }

    pub fn set_follow_custom_proxy(&self, enabled: bool) -> Result<bool, HarnessError> {
        self.config
            .set_bool(LLM_FOLLOW_CUSTOM_PROXY_CONFIG_KEY, enabled)?;
        Ok(enabled)
    }

    pub fn last_selection(&self) -> Result<AssistantRuntimeSelection, HarnessError> {
        self.ensure_migrated()?;
        self.read_last_selection_raw()
    }

    fn read_last_selection_raw(&self) -> Result<AssistantRuntimeSelection, HarnessError> {
        let value = self
            .config
            .get_json(ASSISTANT_LAST_SELECTION_CONFIG_KEY, Value::Null)?;
        Ok(serde_json::from_value(value).unwrap_or_default())
    }

    pub fn set_last_selection(
        &self,
        selection: &AssistantRuntimeSelection,
    ) -> Result<(), HarnessError> {
        let value = serde_json::to_value(selection).map_err(|error| {
            HarnessError::Custom(format!("failed to serialize assistant selection: {error}"))
        })?;
        self.config
            .set_json(ASSISTANT_LAST_SELECTION_CONFIG_KEY, &value)?;
        Ok(())
    }

    pub async fn translate(&self, input: LlmTranslateInput) -> Result<String, HarnessError> {
        let endpoint = self.resolve(&input.endpoint_id)?;
        let model = input.model.trim();
        if model.is_empty() {
            return Err(HarnessError::NotConfigured);
        }
        let prompt = translation_system_prompt(input.prompt.as_deref(), &input.target_lang);
        let client = self.llm_client(&endpoint.base_url, &endpoint.api_key, model)?;
        let options = LlmRequestOptions {
            reasoning_effort: resolve_translation_reasoning_effort(
                &endpoint.base_url,
                &endpoint.model_reasoning,
                model,
                input.reasoning_effort.as_deref(),
            ),
        };
        Ok(client
            .complete_chat(
                &[ChatMessage::system(prompt), ChatMessage::user(input.text)],
                &options,
            )
            .await?)
    }

    pub(crate) fn llm_client(
        &self,
        base_url: &str,
        api_key: &str,
        model: &str,
    ) -> Result<LlmClient, HarnessError> {
        LlmClient::new(base_url, api_key, model, self.explicit_proxy_url()?)
            .map_err(HarnessError::from)
    }

    pub fn follow_custom_proxy(&self) -> Result<bool, HarnessError> {
        self.config
            .get_bool(LLM_FOLLOW_CUSTOM_PROXY_CONFIG_KEY, true)
            .map_err(HarnessError::from)
    }

    pub fn assistant_reasoning_effort(&self) -> Result<String, HarnessError> {
        self.config
            .get_string(ASSISTANT_REASONING_EFFORT_CONFIG_KEY, "")
            .map_err(HarnessError::from)
    }

    pub fn set_assistant_reasoning_effort(&self, effort: &str) -> Result<String, HarnessError> {
        let value = effort.to_string();
        self.config
            .set_string(ASSISTANT_REASONING_EFFORT_CONFIG_KEY, &value)?;
        Ok(value)
    }

    fn explicit_proxy_url(&self) -> Result<Option<&str>, HarnessError> {
        if self.follow_custom_proxy()? {
            return Ok(self.custom_proxy_url.as_deref());
        }
        Ok(None)
    }

    fn resolve_detect_target(
        &self,
        input: &LlmEndpointDetectModelsInput,
    ) -> Result<ResolvedLlmEndpoint, HarnessError> {
        if let Some(id) = input
            .id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            let mut resolved = self.resolve(id)?;
            if let Some(key) = input.api_key.as_deref() {
                resolved.api_key = key.trim().to_string();
            }
            return Ok(resolved);
        }

        let base_url = input
            .base_url
            .as_deref()
            .map(normalize_llm_base_url)
            .unwrap_or_default();
        if base_url.is_empty() {
            return Err(HarnessError::NotConfigured);
        }
        Ok(ResolvedLlmEndpoint {
            base_url,
            api_key: input
                .api_key
                .as_deref()
                .map(str::trim)
                .unwrap_or("")
                .to_string(),
            model_reasoning: Vec::new(),
        })
    }

    fn load_endpoints(&self) -> Result<Vec<StoredLlmEndpoint>, HarnessError> {
        let value = self
            .config
            .get_json(LLM_ENDPOINTS_CONFIG_KEY, Value::Null)?;
        let mut endpoints: Vec<StoredLlmEndpoint> =
            serde_json::from_value(value).unwrap_or_default();
        for endpoint in &mut endpoints {
            endpoint.base_url = normalize_llm_base_url(&endpoint.base_url);
            endpoint.models = normalize_models(std::mem::take(&mut endpoint.models));
        }
        Ok(endpoints)
    }

    fn save_endpoints(&self, endpoints: &[StoredLlmEndpoint]) -> Result<(), HarnessError> {
        let value = serde_json::to_value(endpoints).map_err(|error| {
            HarnessError::Custom(format!("failed to serialize LLM endpoints: {error}"))
        })?;
        self.config.set_json(LLM_ENDPOINTS_CONFIG_KEY, &value)?;
        Ok(())
    }
}

fn to_dto(endpoint: StoredLlmEndpoint) -> LlmEndpointDto {
    LlmEndpointDto {
        id: endpoint.id,
        name: endpoint.name,
        base_url: endpoint.base_url,
        has_key: !deobfuscate_api_key(&endpoint.api_key).is_empty(),
        models: endpoint.models,
        model_reasoning: endpoint.model_reasoning,
        last_detected_at: endpoint.last_detected_at,
    }
}

fn resolve_endpoint(endpoint: StoredLlmEndpoint) -> ResolvedLlmEndpoint {
    ResolvedLlmEndpoint {
        base_url: normalize_llm_base_url(&endpoint.base_url),
        api_key: deobfuscate_api_key(&endpoint.api_key),
        model_reasoning: endpoint.model_reasoning,
    }
}

fn ensure_endpoint(
    endpoints: &mut Vec<StoredLlmEndpoint>,
    fallback_name: &str,
    base_url: &str,
    api_key: &str,
    model: &str,
) -> String {
    let model = model.trim();
    if let Some(endpoint) = endpoints
        .iter_mut()
        .find(|endpoint| normalize_llm_base_url(&endpoint.base_url) == base_url)
    {
        if !api_key.trim().is_empty() && endpoint.api_key.is_empty() {
            endpoint.api_key = obfuscate_api_key(api_key.trim());
        }
        if !model.is_empty() && !endpoint.models.iter().any(|value| value == model) {
            endpoint.models.push(model.to_string());
            endpoint.models = normalize_models(std::mem::take(&mut endpoint.models));
        }
        return endpoint.id.clone();
    }

    let mut models = Vec::new();
    if !model.is_empty() {
        models.push(model.to_string());
    }
    let id = format!("ep_{}", random_hex());
    endpoints.push(StoredLlmEndpoint {
        id: id.clone(),
        name: {
            let name = default_endpoint_name(base_url);
            if name == "LLM Endpoint" {
                fallback_name.to_string()
            } else {
                name
            }
        },
        base_url: base_url.to_string(),
        api_key: obfuscate_api_key(api_key.trim()),
        models,
        model_reasoning: Vec::new(),
        last_detected_at: None,
    });
    id
}

fn default_endpoint_name(base_url: &str) -> String {
    let trimmed = base_url
        .trim()
        .trim_start_matches("https://")
        .trim_start_matches("http://");
    let host = trimmed.split('/').next().unwrap_or("").trim();
    if host.is_empty() {
        "LLM Endpoint".into()
    } else {
        host.to_string()
    }
}

fn normalize_models(models: Vec<String>) -> Vec<String> {
    let mut models: Vec<String> = models
        .into_iter()
        .map(|model| model.trim().to_string())
        .filter(|model| !model.is_empty())
        .collect();
    models.sort();
    models.dedup();
    models
}

fn retain_reasoning_for_models(
    reasoning: Vec<LlmModelReasoning>,
    models: &[String],
) -> Vec<LlmModelReasoning> {
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    reasoning
        .into_iter()
        .filter(|r| models.iter().any(|m| m == &r.model_id) && seen.insert(r.model_id.clone()))
        .collect()
}

fn normalize_model_reasoning(
    reasoning: Vec<LlmModelReasoning>,
    models: &[String],
) -> Vec<LlmModelReasoning> {
    retain_reasoning_for_models(reasoning, models)
}

fn resolve_translation_reasoning_effort(
    base_url: &str,
    model_reasoning: &[LlmModelReasoning],
    model: &str,
    stored_effort: Option<&str>,
) -> Option<String> {
    if !is_openrouter_base_url(base_url) {
        return None;
    }
    let reasoning = model_reasoning.iter().find(|r| r.model_id == model)?;
    let stored = stored_effort.filter(|value| !value.is_empty())?;
    let valid = valid_reasoning_efforts(reasoning);
    if valid.iter().any(|effort| *effort == stored) {
        Some(stored.to_string())
    } else {
        None
    }
}

pub fn resolve_assistant_reasoning_effort(
    base_url: &str,
    model_reasoning: &[LlmModelReasoning],
    model: &str,
    stored_effort: &str,
) -> Option<String> {
    if !is_openrouter_base_url(base_url) {
        return None;
    }
    let reasoning = model_reasoning.iter().find(|r| r.model_id == model)?;
    let stored = stored_effort;
    if stored.is_empty() {
        return None;
    }
    let valid = valid_reasoning_efforts(reasoning);
    if valid.iter().any(|effort| effort == stored) {
        Some(stored.to_string())
    } else {
        None
    }
}

fn valid_reasoning_efforts(reasoning: &LlmModelReasoning) -> Vec<String> {
    reasoning
        .supported_efforts
        .iter()
        .filter(|effort| !effort.is_empty())
        .filter(|effort| !reasoning.mandatory || !is_reasoning_disabling_effort(effort))
        .cloned()
        .collect()
}

fn is_reasoning_disabling_effort(effort: &str) -> bool {
    effort == "none"
}

#[cfg(test)]
mod tests;
