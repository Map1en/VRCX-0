use std::sync::Arc;

use vrcx_0_application::discovery::{
    StandardTranslationFuture, StandardTranslationOutcome, StandardTranslationPort,
    TranslationProvider,
};
use vrcx_0_application_core::WebClient;
use vrcx_0_contracts::external_api::ExternalApiScope;

pub struct LocalTranslationAdapter {
    web: Arc<WebClient>,
}

impl LocalTranslationAdapter {
    pub fn new(web: Arc<WebClient>) -> Self {
        Self { web }
    }
}

impl StandardTranslationPort for LocalTranslationAdapter {
    fn translate(
        &self,
        provider: TranslationProvider,
        key: String,
        text: String,
        target_language: String,
    ) -> StandardTranslationFuture<'_> {
        Box::pin(async move {
            let request = match provider {
                TranslationProvider::Google => {
                    vrcx_0_integrations::translation::google_translate_request(
                        &key,
                        &text,
                        &target_language,
                    )
                }
                TranslationProvider::DeepL => {
                    vrcx_0_integrations::translation::deepl_translate_request(
                        &key,
                        &text,
                        &target_language,
                    )
                }
                TranslationProvider::OpenAi => {
                    return Err(crate::Error::Custom(
                        "OpenAI translation must use the OpenAI translation port.".into(),
                    ));
                }
            }
            .map_err(|error| crate::Error::Custom(error.to_string()))?;
            let response = self
                .web
                .execute_external_api(request, ExternalApiScope::Translation)
                .await?;
            if response.status != 200 {
                return Err(crate::Error::Custom(format!(
                    "Translation API error: {}",
                    response.status
                )));
            }
            let outcome = match provider {
                TranslationProvider::Google => {
                    vrcx_0_integrations::translation::parse_google_translation_response(
                        &response.data,
                    )
                }
                TranslationProvider::DeepL => {
                    vrcx_0_integrations::translation::parse_deepl_translation_response(
                        &response.data,
                    )
                }
                TranslationProvider::OpenAi => unreachable!(),
            }
            .map_err(|error| crate::Error::Custom(error.to_string()))?;
            Ok(StandardTranslationOutcome {
                text: outcome.text,
                detected_source_language: outcome.detected_source_language,
            })
        })
    }
}
