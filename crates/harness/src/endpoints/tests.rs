use std::sync::{Arc, Barrier};

use vrcx_0_persistence::DatabaseService;

use crate::config::{
    ASSISTANT_API_KEY_CONFIG_KEY, ASSISTANT_BASE_URL_CONFIG_KEY, ASSISTANT_MODEL_CONFIG_KEY,
};
use crate::test_support::unique_test_database_path;

use super::*;

fn test_config() -> ConfigRepository {
    ConfigRepository::new(Arc::new(
        DatabaseService::new(&unique_test_database_path("vrcx-0-llm-endpoints")).unwrap(),
    ))
}

#[test]
fn test_configs_initialize_in_parallel_without_sharing_a_database() {
    let barrier = Arc::new(Barrier::new(16));
    let threads = (0..16)
        .map(|_| {
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                drop(test_config());
            })
        })
        .collect::<Vec<_>>();

    for thread in threads {
        thread.join().unwrap();
    }
}

#[test]
fn custom_proxy_following_defaults_on_and_persists_globally() {
    let config = test_config();
    let proxy_url = "http://127.0.0.1:7890";
    let store = EndpointStore::new(config.clone(), Some(proxy_url.into()));

    assert!(store.follow_custom_proxy().unwrap());
    assert_eq!(store.explicit_proxy_url().unwrap(), Some(proxy_url));
    assert!(!store.set_follow_custom_proxy(false).unwrap());
    assert_eq!(store.explicit_proxy_url().unwrap(), None);

    let reloaded = EndpointStore::new(config, Some(proxy_url.into()));
    assert!(!reloaded.follow_custom_proxy().unwrap());
    assert_eq!(reloaded.explicit_proxy_url().unwrap(), None);
}

#[test]
fn custom_proxy_following_without_active_proxy_uses_system_behavior() {
    let store = EndpointStore::new(test_config(), None);

    assert!(store.follow_custom_proxy().unwrap());
    assert_eq!(store.explicit_proxy_url().unwrap(), None);
}

#[test]
fn upsert_preserves_clears_and_drops_keys_on_provider_change() {
    let store = EndpointStore::new(test_config(), None);
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

    let store = EndpointStore::new(config.clone(), None);
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

    let store = EndpointStore::new(config, None);
    let migrated = store.list().unwrap();
    assert_eq!(migrated.len(), 1);

    store.delete(&migrated[0].id).unwrap();

    assert!(store.list().unwrap().is_empty());
}

#[test]
fn delete_clears_last_selection_and_falls_back_translation_endpoint() {
    let config = test_config();
    let store = EndpointStore::new(config.clone(), None);
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
