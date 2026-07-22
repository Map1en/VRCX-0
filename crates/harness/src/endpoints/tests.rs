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
fn translation_prompt_substitutes_target_lang_in_default_and_custom_prompts() {
    assert_eq!(
        translation_system_prompt(None, "Japanese"),
        "You are a translation assistant. Translate the user message into Japanese. Only return the translated text."
    );
    assert_eq!(
        translation_system_prompt(
            Some("  Translate into {targetLang}, casual tone.  "),
            "French"
        ),
        "Translate into French, casual tone."
    );
    assert_eq!(
        translation_system_prompt(Some("Keep it literal."), "French"),
        "Keep it literal."
    );
    assert!(translation_system_prompt(Some("   "), "German").contains("into German."));
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
fn reasoning_preferences_round_trip_without_changing_api_values() {
    let store = EndpointStore::new(test_config(), None);

    assert_eq!(
        store.set_assistant_reasoning_effort(" xhigh ").unwrap(),
        " xhigh "
    );
    assert_eq!(store.assistant_reasoning_effort().unwrap(), " xhigh ");
    assert_eq!(
        store.set_assistant_reasoning_effort("NONE").unwrap(),
        "NONE"
    );
    assert_eq!(store.assistant_reasoning_effort().unwrap(), "NONE");
}

#[test]
fn reasoning_resolvers_require_openrouter_exact_model_and_effort_matches() {
    let reasoning = vec![LlmModelReasoning {
        model_id: "model-a".into(),
        supported_efforts: vec![" high ".into(), "none".into(), "off".into()],
        mandatory: true,
    }];

    assert_eq!(
        resolve_translation_reasoning_effort(
            "https://openrouter.ai/api/v1",
            &reasoning,
            "model-a",
            Some(" high "),
        ),
        Some(" high ".into())
    );
    assert_eq!(
        resolve_assistant_reasoning_effort(
            "https://openrouter.ai/api/v1",
            &reasoning,
            "model-a",
            "off",
        ),
        Some("off".into())
    );
    assert_eq!(
        resolve_assistant_reasoning_effort(
            "https://openrouter.ai/api/v1",
            &reasoning,
            "model-a",
            "none",
        ),
        None
    );
    assert_eq!(
        resolve_assistant_reasoning_effort(
            "https://openrouter.ai/api/v1",
            &reasoning,
            "model-a",
            "high",
        ),
        None
    );
    assert_eq!(
        resolve_assistant_reasoning_effort(
            "https://api.openai.com/v1",
            &reasoning,
            "model-a",
            " high ",
        ),
        None
    );
}

#[test]
fn endpoint_json_without_model_reasoning_remains_compatible() {
    let config = test_config();
    config
        .set_json(
            LLM_ENDPOINTS_CONFIG_KEY,
            &serde_json::json!([{
                "id": "ep_old",
                "name": "Old endpoint",
                "baseUrl": "https://example.com/v1",
                "apiKey": "",
                "models": ["model-a"],
                "lastDetectedAt": null
            }]),
        )
        .unwrap();

    let endpoints = EndpointStore::new(config, None).list().unwrap();

    assert_eq!(endpoints.len(), 1);
    assert!(endpoints[0].model_reasoning.is_empty());
}

#[test]
fn endpoint_upsert_retains_only_current_models_and_clears_reasoning_on_url_change() {
    let config = test_config();
    config
        .set_json(
            LLM_ENDPOINTS_CONFIG_KEY,
            &serde_json::json!([{
                "id": "ep_openrouter",
                "name": "OpenRouter",
                "baseUrl": "https://openrouter.ai/api/v1",
                "apiKey": "",
                "models": ["model-a", "model-b"],
                "modelReasoning": [
                    {
                        "modelId": "model-a",
                        "supportedEfforts": ["low"],
                        "mandatory": false
                    },
                    {
                        "modelId": "model-b",
                        "supportedEfforts": ["high"],
                        "mandatory": false
                    }
                ],
                "lastDetectedAt": null
            }]),
        )
        .unwrap();
    let store = EndpointStore::new(config, None);

    let filtered = store
        .upsert(LlmEndpointUpsertInput {
            id: Some("ep_openrouter".into()),
            name: "OpenRouter".into(),
            base_url: "https://openrouter.ai/api/v1".into(),
            api_key: None,
            models: vec!["model-b".into()],
            model_reasoning: None,
        })
        .unwrap();
    assert_eq!(filtered.model_reasoning.len(), 1);
    assert_eq!(filtered.model_reasoning[0].model_id, "model-b");

    let changed = store
        .upsert(LlmEndpointUpsertInput {
            id: Some("ep_openrouter".into()),
            name: "Custom".into(),
            base_url: "https://example.com/v1".into(),
            api_key: None,
            models: vec!["model-b".into()],
            model_reasoning: None,
        })
        .unwrap();
    assert!(changed.model_reasoning.is_empty());
}

#[test]
fn endpoint_upsert_persists_provided_reasoning_for_new_endpoints() {
    let store = EndpointStore::new(test_config(), None);

    let saved = store
        .upsert(LlmEndpointUpsertInput {
            id: None,
            name: "OpenRouter".into(),
            base_url: "https://openrouter.ai/api/v1".into(),
            api_key: None,
            models: vec!["model-a".into(), "model-b".into()],
            model_reasoning: Some(vec![
                LlmModelReasoning {
                    model_id: "model-a".into(),
                    supported_efforts: vec!["high".into()],
                    mandatory: false,
                },
                LlmModelReasoning {
                    model_id: "removed-model".into(),
                    supported_efforts: vec!["low".into()],
                    mandatory: false,
                },
            ]),
        })
        .unwrap();

    assert_eq!(saved.model_reasoning.len(), 1);
    assert_eq!(saved.model_reasoning[0].model_id, "model-a");

    let reloaded = store.list().unwrap();
    assert_eq!(reloaded[0].model_reasoning.len(), 1);
    assert_eq!(reloaded[0].model_reasoning[0].model_id, "model-a");
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
            model_reasoning: None,
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
            model_reasoning: None,
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
            model_reasoning: None,
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
            model_reasoning: None,
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
            model_reasoning: None,
        })
        .unwrap();
    let second = store
        .upsert(LlmEndpointUpsertInput {
            id: None,
            name: "Second".into(),
            base_url: "https://second.example/v1".into(),
            api_key: Some("sk-second".into()),
            models: vec!["second-model".into()],
            model_reasoning: None,
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
