use serde::{Deserialize, Serialize};
use vrcx_0_integrations::llm::LlmClient;
use vrcx_0_persistence::config::ConfigRepository;

use crate::error::HarnessError;

pub const ASSISTANT_BASE_URL_CONFIG_KEY: &str = "assistant.baseUrl";
pub const ASSISTANT_API_KEY_CONFIG_KEY: &str = "assistant.apiKey";
pub const ASSISTANT_MODEL_CONFIG_KEY: &str = "assistant.model";
pub const ASSISTANT_ALLOW_WRITES_CONFIG_KEY: &str = "assistant.allowWrites";
pub const ASSISTANT_PLAYBOOK_MODE_CONFIG_KEY: &str = "assistant.playbookMode";

const DEFAULT_BASE_URL: &str = "https://api.openai.com/v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum PlaybookMode {
    #[default]
    Auto,
    Guided,
    Open,
}

impl PlaybookMode {
    pub(crate) fn parse(raw: &str) -> Self {
        match raw.trim() {
            "guided" => Self::Guided,
            "open" => Self::Open,
            _ => Self::Auto,
        }
    }

    pub(crate) fn as_config_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Guided => "guided",
            Self::Open => "open",
        }
    }
}

#[derive(Debug, Clone)]
pub struct AssistantConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub allow_writes: bool,
    pub playbook_mode: PlaybookMode,
}

impl AssistantConfig {
    pub fn load(config: &ConfigRepository) -> Result<Self, HarnessError> {
        let base_url = config.get_string(ASSISTANT_BASE_URL_CONFIG_KEY, DEFAULT_BASE_URL)?;
        let api_key = config.get_string(ASSISTANT_API_KEY_CONFIG_KEY, "")?;
        let model = config.get_string(ASSISTANT_MODEL_CONFIG_KEY, "")?;
        let allow_writes = config.get_bool(ASSISTANT_ALLOW_WRITES_CONFIG_KEY, false)?;
        let playbook_mode =
            PlaybookMode::parse(&config.get_string(ASSISTANT_PLAYBOOK_MODE_CONFIG_KEY, "auto")?);
        Ok(Self {
            base_url: normalize_llm_base_url(&base_url),
            api_key: deobfuscate_api_key(api_key.trim()),
            model: model.trim().to_string(),
            allow_writes,
            playbook_mode,
        })
    }

    pub fn is_configured(&self) -> bool {
        // The API key is optional: local endpoints (Ollama, LM Studio) accept
        // anonymous requests, so only a base URL and model are required.
        !self.base_url.is_empty() && !self.model.is_empty()
    }

    pub fn is_local(&self) -> bool {
        is_local_llm_endpoint(&self.base_url)
    }

    pub fn should_apply_playbook(&self) -> bool {
        should_apply_playbook(self.playbook_mode, &self.base_url)
    }

    pub fn build_client(&self) -> Result<LlmClient, HarnessError> {
        if !self.is_configured() {
            return Err(HarnessError::NotConfigured);
        }
        Ok(LlmClient::new(&self.base_url, &self.api_key, &self.model))
    }
}

pub(crate) fn normalize_llm_base_url(raw: &str) -> String {
    let mut value = raw.trim().trim_end_matches('/').to_string();
    let lowered = value.to_ascii_lowercase();
    if lowered.ends_with("/chat/completions") {
        value.truncate(value.len() - "/chat/completions".len());
        value = value.trim_end_matches('/').to_string();
    }
    value
}

pub(crate) fn is_local_llm_endpoint(base_url: &str) -> bool {
    let lowered = base_url.to_ascii_lowercase();
    lowered.contains("localhost") || lowered.contains("127.0.0.1") || lowered.contains("[::1]")
}

pub(crate) fn should_apply_playbook(playbook_mode: PlaybookMode, base_url: &str) -> bool {
    match playbook_mode {
        PlaybookMode::Guided => true,
        PlaybookMode::Open => false,
        PlaybookMode::Auto => is_local_llm_endpoint(base_url),
    }
}

const API_KEY_OBFUSCATION_PREFIX: &str = "obf1:";
const API_KEY_OBFUSCATION_MASK: &[u8] = b"vrcx-0-assistant";

// Obfuscation, NOT encryption: a static-XOR + hex transform so the key is not
// stored as readable plaintext in the local config table. It deters casual
// reading, not an attacker with the binary.
pub(crate) fn obfuscate_api_key(plain: &str) -> String {
    if plain.is_empty() {
        return String::new();
    }
    let body: String = plain
        .bytes()
        .enumerate()
        .map(|(index, byte)| {
            let masked = byte ^ API_KEY_OBFUSCATION_MASK[index % API_KEY_OBFUSCATION_MASK.len()];
            format!("{masked:02x}")
        })
        .collect();
    format!("{API_KEY_OBFUSCATION_PREFIX}{body}")
}

pub(crate) fn deobfuscate_api_key(stored: &str) -> String {
    // Keys saved before obfuscation existed carry no prefix — pass them through.
    let Some(body) = stored.strip_prefix(API_KEY_OBFUSCATION_PREFIX) else {
        return stored.to_string();
    };
    let decoded: Option<Vec<u8>> = (0..body.len())
        .step_by(2)
        .map(|index| {
            body.get(index..index + 2)
                .and_then(|pair| u8::from_str_radix(pair, 16).ok())
        })
        .collect();
    let Some(bytes) = decoded else {
        return String::new();
    };
    let plain: Vec<u8> = bytes
        .iter()
        .enumerate()
        .map(|(index, byte)| {
            byte ^ API_KEY_OBFUSCATION_MASK[index % API_KEY_OBFUSCATION_MASK.len()]
        })
        .collect();
    String::from_utf8(plain).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn llm_base_url_normalization_accepts_chat_completion_urls() {
        assert_eq!(
            normalize_llm_base_url(" https://api.openai.com/v1/chat/completions/ "),
            "https://api.openai.com/v1"
        );
        assert_eq!(
            normalize_llm_base_url("http://127.0.0.1:1234/v1/"),
            "http://127.0.0.1:1234/v1"
        );
    }

    #[test]
    fn playbook_auto_uses_local_endpoint_heuristic() {
        assert!(should_apply_playbook(
            PlaybookMode::Auto,
            "http://localhost:1234/v1"
        ));
        assert!(!should_apply_playbook(
            PlaybookMode::Auto,
            "https://api.openai.com/v1"
        ));
        assert!(should_apply_playbook(
            PlaybookMode::Guided,
            "https://api.openai.com/v1"
        ));
        assert!(!should_apply_playbook(
            PlaybookMode::Open,
            "http://localhost:1234/v1"
        ));
    }

    #[test]
    fn obfuscation_round_trips() {
        let key = "sk-проверка-🔑-test-12345";
        let stored = obfuscate_api_key(key);
        assert!(stored.starts_with(API_KEY_OBFUSCATION_PREFIX));
        assert!(!stored.contains("sk-"));
        assert_eq!(deobfuscate_api_key(&stored), key);
    }

    #[test]
    fn empty_key_stays_empty() {
        assert_eq!(obfuscate_api_key(""), "");
        assert_eq!(deobfuscate_api_key(""), "");
    }

    #[test]
    fn legacy_plaintext_passes_through() {
        assert_eq!(
            deobfuscate_api_key("sk-legacy-plaintext"),
            "sk-legacy-plaintext"
        );
    }
}
