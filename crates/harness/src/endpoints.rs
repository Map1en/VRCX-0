use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;
use vrcx_0_integrations::llm::{ChatMessage, LlmClient};
use vrcx_0_persistence::config::ConfigRepository;

use crate::config::{
    deobfuscate_api_key, normalize_llm_base_url, obfuscate_api_key, PlaybookMode,
    ASSISTANT_ALLOW_WRITES_CONFIG_KEY, ASSISTANT_API_KEY_CONFIG_KEY, ASSISTANT_BASE_URL_CONFIG_KEY,
    ASSISTANT_MODEL_CONFIG_KEY, ASSISTANT_PLAYBOOK_MODE_CONFIG_KEY,
};
use crate::error::HarnessError;
use crate::session::random_hex;

const LLM_ENDPOINTS_CONFIG_KEY: &str = "llm.endpoints";
const ASSISTANT_LAST_SELECTION_CONFIG_KEY: &str = "assistant.lastSelection";
const LEGACY_MIGRATION_DONE_KEY: &str = "llm.endpoints.legacyMigrated";
const TRANSLATION_ENDPOINT_ID_CONFIG_KEY: &str = "translationEndpointId";
const TRANSLATION_API_TYPE_CONFIG_KEY: &str = "translationAPIType";
const TRANSLATION_API_ENDPOINT_CONFIG_KEY: &str = "translationAPIEndpoint";
const TRANSLATION_API_KEY_CONFIG_KEY: &str = "translationAPIKey";
const TRANSLATION_API_MODEL_CONFIG_KEY: &str = "translationAPIModel";
const DEFAULT_TRANSLATION_SYSTEM_PROMPT: &str =
    "You are a translation assistant. Translate the user message into {targetLang}. Only return the translated text.";

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
    last_detected_at: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ResolvedLlmEndpoint {
    pub base_url: String,
    pub api_key: String,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LlmEndpointDto {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub has_key: bool,
    pub models: Vec<String>,
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
    // Serializes read-modify-write of the endpoints blob across concurrent writers.
    write_lock: Arc<Mutex<()>>,
    migrated: Arc<AtomicBool>,
}

impl EndpointStore {
    pub fn new(config: ConfigRepository) -> Self {
        Self {
            config,
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
        let endpoint = StoredLlmEndpoint {
            id: id.clone(),
            name,
            base_url,
            api_key,
            models,
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
    ) -> Result<Vec<String>, HarnessError> {
        self.ensure_migrated()?;
        let resolved = self.resolve_detect_target(&input)?;
        let client = LlmClient::new(&resolved.base_url, &resolved.api_key, "");
        let models = normalize_models(client.list_models().await?);

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
                    endpoint.last_detected_at = Some(chrono::Utc::now().to_rfc3339());
                    self.save_endpoints(&endpoints)?;
                }
            }
        }

        Ok(models)
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
        let prompt = input
            .prompt
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| {
                DEFAULT_TRANSLATION_SYSTEM_PROMPT.replace("{targetLang}", &input.target_lang)
            });
        let client = LlmClient::new(endpoint.base_url, endpoint.api_key, model);
        Ok(client
            .complete_chat(&[ChatMessage::system(prompt), ChatMessage::user(input.text)])
            .await?)
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

    fn ensure_migrated(&self) -> Result<(), HarnessError> {
        if self.migrated.load(Ordering::Relaxed) {
            return Ok(());
        }
        let _guard = self.write_lock.lock().unwrap();
        if self.migrated.load(Ordering::Relaxed) {
            return Ok(());
        }
        if !self.config.get_bool(LEGACY_MIGRATION_DONE_KEY, false)? {
            self.migrate_legacy_configs()?;
        }
        self.migrated.store(true, Ordering::Relaxed);
        Ok(())
    }

    fn migrate_legacy_configs(&self) -> Result<(), HarnessError> {
        let mut endpoints = self.load_endpoints()?;
        let mut changed = false;

        let current_selection = self.read_last_selection_raw()?;
        let needs_assistant_seed =
            current_selection.endpoint_id.is_none() && current_selection.model.is_none();
        if needs_assistant_seed {
            if let Some((endpoint_id, model, allow_writes, playbook_mode)) =
                self.migrate_legacy_assistant_endpoint(&mut endpoints)?
            {
                let selection = AssistantRuntimeSelection {
                    endpoint_id: Some(endpoint_id),
                    model,
                    allow_writes,
                    playbook_mode,
                };
                self.set_last_selection(&selection)?;
                changed = true;
            }
        }

        if let Some(endpoint_id) = self.migrate_legacy_translation_endpoint(&mut endpoints)? {
            self.config
                .set_string(TRANSLATION_ENDPOINT_ID_CONFIG_KEY, &endpoint_id)?;
            changed = true;
        }

        if changed {
            self.save_endpoints(&endpoints)?;
        }
        self.config.set_bool(LEGACY_MIGRATION_DONE_KEY, true)?;
        Ok(())
    }

    fn migrate_legacy_assistant_endpoint(
        &self,
        endpoints: &mut Vec<StoredLlmEndpoint>,
    ) -> Result<Option<LegacyAssistantSeed>, HarnessError> {
        let base_url =
            normalize_llm_base_url(&self.config.get_string(ASSISTANT_BASE_URL_CONFIG_KEY, "")?);
        let model = self
            .config
            .get_string(ASSISTANT_MODEL_CONFIG_KEY, "")?
            .trim()
            .to_string();
        let api_key = deobfuscate_api_key(
            self.config
                .get_string(ASSISTANT_API_KEY_CONFIG_KEY, "")?
                .trim(),
        );
        if base_url.is_empty() || model.is_empty() {
            return Ok(None);
        }
        let endpoint_id =
            ensure_endpoint(endpoints, "Assistant", &base_url, &api_key, model.as_str());
        Ok(Some((
            endpoint_id,
            Some(model),
            self.config
                .get_bool(ASSISTANT_ALLOW_WRITES_CONFIG_KEY, false)?,
            PlaybookMode::parse(
                &self
                    .config
                    .get_string(ASSISTANT_PLAYBOOK_MODE_CONFIG_KEY, "auto")?,
            ),
        )))
    }

    fn migrate_legacy_translation_endpoint(
        &self,
        endpoints: &mut Vec<StoredLlmEndpoint>,
    ) -> Result<Option<String>, HarnessError> {
        if self
            .config
            .get_string(TRANSLATION_ENDPOINT_ID_CONFIG_KEY, "")?
            .trim()
            .is_empty()
            && self
                .config
                .get_string(TRANSLATION_API_TYPE_CONFIG_KEY, "google")?
                .trim()
                .eq_ignore_ascii_case("openai")
        {
            let base_url = normalize_llm_base_url(
                &self
                    .config
                    .get_string(TRANSLATION_API_ENDPOINT_CONFIG_KEY, "")?,
            );
            let model = self
                .config
                .get_string(TRANSLATION_API_MODEL_CONFIG_KEY, "")?
                .trim()
                .to_string();
            if base_url.is_empty() || model.is_empty() {
                return Ok(None);
            }
            let endpoint_id = ensure_endpoint(
                endpoints,
                "Translation",
                &base_url,
                &self.config.get_string(TRANSLATION_API_KEY_CONFIG_KEY, "")?,
                model.as_str(),
            );
            return Ok(Some(endpoint_id));
        }
        Ok(None)
    }
}

fn to_dto(endpoint: StoredLlmEndpoint) -> LlmEndpointDto {
    LlmEndpointDto {
        id: endpoint.id,
        name: endpoint.name,
        base_url: endpoint.base_url,
        has_key: !deobfuscate_api_key(&endpoint.api_key).is_empty(),
        models: endpoint.models,
        last_detected_at: endpoint.last_detected_at,
    }
}

fn resolve_endpoint(endpoint: StoredLlmEndpoint) -> ResolvedLlmEndpoint {
    ResolvedLlmEndpoint {
        base_url: normalize_llm_base_url(&endpoint.base_url),
        api_key: deobfuscate_api_key(&endpoint.api_key),
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

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use vrcx_0_persistence::DatabaseService;

    use super::*;

    fn test_config() -> ConfigRepository {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "vrcx-0-llm-endpoints-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        ConfigRepository::new(Arc::new(
            DatabaseService::new(&dir.join("VRCX-0.sqlite3")).unwrap(),
        ))
    }

    #[test]
    fn upsert_preserves_clears_and_drops_keys_on_provider_change() {
        let store = EndpointStore::new(test_config());
        let saved = store
            .upsert(LlmEndpointUpsertInput {
                id: None,
                name: "OpenAI".into(),
                base_url: "https://api.openai.com/v1/chat/completions".into(),
                api_key: Some("sk-old".into()),
                models: vec!["gpt-4o-mini".into()],
            })
            .unwrap();
        assert!(saved.has_key);
        assert_eq!(saved.base_url, "https://api.openai.com/v1");

        let preserved = store
            .upsert(LlmEndpointUpsertInput {
                id: Some(saved.id.clone()),
                name: "OpenAI".into(),
                base_url: "https://api.openai.com/v1".into(),
                api_key: None,
                models: vec!["gpt-4o-mini".into()],
            })
            .unwrap();
        assert!(preserved.has_key);

        let dropped = store
            .upsert(LlmEndpointUpsertInput {
                id: Some(saved.id.clone()),
                name: "Other".into(),
                base_url: "https://example.com/v1".into(),
                api_key: None,
                models: vec!["model".into()],
            })
            .unwrap();
        assert!(!dropped.has_key);

        let cleared = store
            .upsert(LlmEndpointUpsertInput {
                id: Some(saved.id),
                name: "Other".into(),
                base_url: "https://example.com/v1".into(),
                api_key: Some(String::new()),
                models: vec!["model".into()],
            })
            .unwrap();
        assert!(!cleared.has_key);
    }

    #[test]
    fn legacy_assistant_and_translation_configs_migrate_and_dedupe() {
        let config = test_config();
        config
            .set_string(
                ASSISTANT_BASE_URL_CONFIG_KEY,
                "https://api.openai.com/v1/chat/completions",
            )
            .unwrap();
        config
            .set_string(ASSISTANT_API_KEY_CONFIG_KEY, &obfuscate_api_key("sk-a"))
            .unwrap();
        config
            .set_string(ASSISTANT_MODEL_CONFIG_KEY, "gpt-4o-mini")
            .unwrap();
        config
            .set_string(TRANSLATION_API_TYPE_CONFIG_KEY, "openai")
            .unwrap();
        config
            .set_string(
                TRANSLATION_API_ENDPOINT_CONFIG_KEY,
                "https://api.openai.com/v1/chat/completions",
            )
            .unwrap();
        config
            .set_string(TRANSLATION_API_KEY_CONFIG_KEY, "sk-a")
            .unwrap();
        config
            .set_string(TRANSLATION_API_MODEL_CONFIG_KEY, "gpt-4o-mini")
            .unwrap();

        let store = EndpointStore::new(config.clone());
        let endpoints = store.list().unwrap();
        assert_eq!(endpoints.len(), 1);
        assert_eq!(endpoints[0].base_url, "https://api.openai.com/v1");
        assert_eq!(endpoints[0].models, vec!["gpt-4o-mini"]);
        assert_eq!(
            config
                .get_string(TRANSLATION_ENDPOINT_ID_CONFIG_KEY, "")
                .unwrap(),
            endpoints[0].id
        );
        assert_eq!(
            store.last_selection().unwrap().endpoint_id.as_deref(),
            Some(endpoints[0].id.as_str())
        );
    }

    #[test]
    fn deleting_migrated_endpoint_does_not_resurrect_it() {
        let config = test_config();
        config
            .set_string(ASSISTANT_BASE_URL_CONFIG_KEY, "https://api.openai.com/v1")
            .unwrap();
        config
            .set_string(ASSISTANT_MODEL_CONFIG_KEY, "gpt-4o-mini")
            .unwrap();

        let store = EndpointStore::new(config);
        let migrated = store.list().unwrap();
        assert_eq!(migrated.len(), 1);

        store.delete(&migrated[0].id).unwrap();

        assert!(store.list().unwrap().is_empty());
    }

    #[test]
    fn delete_clears_last_selection_and_falls_back_translation_endpoint() {
        let config = test_config();
        let store = EndpointStore::new(config.clone());
        let first = store
            .upsert(LlmEndpointUpsertInput {
                id: None,
                name: "First".into(),
                base_url: "https://first.example/v1".into(),
                api_key: Some("sk-first".into()),
                models: vec!["first-model".into()],
            })
            .unwrap();
        let second = store
            .upsert(LlmEndpointUpsertInput {
                id: None,
                name: "Second".into(),
                base_url: "https://second.example/v1".into(),
                api_key: Some("sk-second".into()),
                models: vec!["second-model".into()],
            })
            .unwrap();

        store
            .set_last_selection(&AssistantRuntimeSelection {
                endpoint_id: Some(first.id.clone()),
                model: Some("first-model".into()),
                allow_writes: true,
                playbook_mode: PlaybookMode::Guided,
            })
            .unwrap();
        config
            .set_string(TRANSLATION_ENDPOINT_ID_CONFIG_KEY, &first.id)
            .unwrap();

        store.delete(&first.id).unwrap();

        let selection = store.last_selection().unwrap();
        assert!(selection.endpoint_id.is_none());
        assert!(selection.model.is_none());
        assert_eq!(
            config
                .get_string(TRANSLATION_ENDPOINT_ID_CONFIG_KEY, "")
                .unwrap(),
            second.id
        );
    }
}
