use serde::{Deserialize, Serialize};

pub(crate) const ASSISTANT_BASE_URL_CONFIG_KEY: &str = "assistant.baseUrl";
pub(crate) const ASSISTANT_API_KEY_CONFIG_KEY: &str = "assistant.apiKey";
pub(crate) const ASSISTANT_MODEL_CONFIG_KEY: &str = "assistant.model";
pub(crate) const ASSISTANT_PLAYBOOK_MODE_CONFIG_KEY: &str = "assistant.playbookMode";

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
    matches!(
        endpoint_host(base_url).as_deref(),
        Some("localhost" | "127.0.0.1" | "::1")
    )
}

fn endpoint_host(base_url: &str) -> Option<String> {
    let trimmed = base_url.trim();
    let rest = match trimmed.split_once("://") {
        Some((scheme, rest)) if is_url_scheme(scheme) => rest,
        _ => trimmed,
    };
    let authority = rest.split(['/', '\\', '?', '#']).next().unwrap_or_default();
    let host_port = authority
        .rsplit_once('@')
        .map_or(authority, |(_, host_port)| host_port);
    let host = match host_port.strip_prefix('[') {
        Some(bracketed) => bracketed.split(']').next().unwrap_or_default(),
        None => host_port.split(':').next().unwrap_or_default(),
    };
    (!host.is_empty()).then(|| host.to_ascii_lowercase())
}

fn is_url_scheme(text: &str) -> bool {
    !text.is_empty()
        && text
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '+' | '-' | '.'))
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
    fn local_endpoint_detection_matches_exact_hosts_only() {
        assert!(is_local_llm_endpoint("http://localhost:1234/v1"));
        assert!(is_local_llm_endpoint("http://127.0.0.1:1234/v1"));
        assert!(is_local_llm_endpoint("http://[::1]:1234/v1"));
        assert!(is_local_llm_endpoint("HTTP://LOCALHOST/v1"));
        assert!(is_local_llm_endpoint("http://user:pass@localhost:1234/v1"));
        assert!(is_local_llm_endpoint("localhost:1234/v1"));
        assert!(is_local_llm_endpoint("localhost:1234/v1?next=https://x"));

        assert!(!is_local_llm_endpoint("http://127.0.0.1.evil.com/v1"));
        assert!(!is_local_llm_endpoint(
            "http://evil.com\\@localhost:1234/v1"
        ));
        assert!(!is_local_llm_endpoint("http://localhost.evil.com/v1"));
        assert!(!is_local_llm_endpoint(
            "https://api.openai.com/v1?x=localhost"
        ));
        assert!(!is_local_llm_endpoint("https://evil.com/localhost/v1"));
        assert!(!is_local_llm_endpoint(""));
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
