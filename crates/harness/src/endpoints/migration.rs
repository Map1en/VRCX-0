use std::sync::atomic::Ordering;

use crate::config::{
    deobfuscate_api_key, normalize_llm_base_url, PlaybookMode, ASSISTANT_ALLOW_WRITES_CONFIG_KEY,
    ASSISTANT_API_KEY_CONFIG_KEY, ASSISTANT_BASE_URL_CONFIG_KEY, ASSISTANT_MODEL_CONFIG_KEY,
    ASSISTANT_PLAYBOOK_MODE_CONFIG_KEY,
};
use crate::error::HarnessError;

use super::{
    ensure_endpoint, AssistantRuntimeSelection, EndpointStore, LegacyAssistantSeed,
    StoredLlmEndpoint, LEGACY_MIGRATION_DONE_KEY, TRANSLATION_API_ENDPOINT_CONFIG_KEY,
    TRANSLATION_API_KEY_CONFIG_KEY, TRANSLATION_API_MODEL_CONFIG_KEY,
    TRANSLATION_API_TYPE_CONFIG_KEY, TRANSLATION_ENDPOINT_ID_CONFIG_KEY,
};

impl EndpointStore {
    pub(super) fn ensure_migrated(&self) -> Result<(), HarnessError> {
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
