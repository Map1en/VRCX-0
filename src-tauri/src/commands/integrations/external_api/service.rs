#![allow(non_snake_case)]

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_integrations::external_api::{
    self, ExternalApiExecuteResponse, ExternalApiPolicy, ExternalApiScope, ExternalHttpRequestInput,
};

use super::types::{
    ExternalApiAvatarSearchInput, ExternalApiImageInput, ExternalApiTranslationInput,
    ExternalApiUrlInput, ExternalApiYoutubeVideoInput,
};

fn normalize_text(value: impl AsRef<str>) -> String {
    value.as_ref().trim().to_string()
}

fn require_text(value: impl AsRef<str>, message: &str) -> Result<String, AppError> {
    let value = normalize_text(value);
    if value.is_empty() {
        return Err(AppError::Custom(message.into()));
    }
    Ok(value)
}

fn avatar_search_input(
    input: ExternalApiAvatarSearchInput,
) -> Result<ExternalHttpRequestInput, AppError> {
    let url = require_text(input.url, "ExternalApiAvatarSearchGet requires url.")?;
    let vrcx_id = require_text(input.vrcx_id, "ExternalApiAvatarSearchGet requires vrcxId.")?;
    Ok(external_api::avatar_search_get_input(&url, &vrcx_id))
}

fn translation_input(
    input: ExternalApiTranslationInput,
) -> Result<ExternalHttpRequestInput, AppError> {
    let url = require_text(input.url, "ExternalApiTranslationRequest requires url.")?;
    external_api::translation_request_input(&url, &input.method, input.headers, input.body)
        .map_err(|error| AppError::Custom(error.to_string()))
}

fn youtube_video_input(
    input: ExternalApiYoutubeVideoInput,
) -> Result<ExternalHttpRequestInput, AppError> {
    let video_id = require_text(
        input.video_id,
        "ExternalApiYoutubeVideoMetadataGet requires videoId.",
    )?;
    let api_key = require_text(
        input.api_key,
        "ExternalApiYoutubeVideoMetadataGet requires apiKey.",
    )?;
    Ok(external_api::youtube_video_metadata_get_input(
        &video_id, &api_key,
    ))
}

fn github_releases_input(input: ExternalApiUrlInput) -> Result<ExternalHttpRequestInput, AppError> {
    let url = require_text(input.url, "ExternalApiGithubReleasesGet requires url.")?;
    Ok(external_api::github_releases_get_input(&url, input.headers))
}

fn github_contributors_input(
    input: ExternalApiUrlInput,
) -> Result<ExternalHttpRequestInput, AppError> {
    let url = require_text(input.url, "ExternalApiGithubContributorsGet requires url.")?;
    Ok(external_api::github_contributors_get_input(
        &url,
        input.headers,
    ))
}

fn image_data_url_input(
    input: ExternalApiImageInput,
) -> Result<ExternalHttpRequestInput, AppError> {
    let url = require_text(input.url, "ExternalApiImageDataUrlGet requires url.")?;
    Ok(external_api::image_data_url_get_input(&url))
}

fn external_api_policy(_state: &AppState, _scope: ExternalApiScope) -> ExternalApiPolicy {
    ExternalApiPolicy
}

macro_rules! external_command {
    ($name:ident, $input_ty:ty, $builder:ident, $scope:expr, $detail:expr) => {
        #[tauri::command]
        #[specta::specta]
        pub async fn $name(
            state: State<'_, AppState>,
            input: $input_ty,
        ) -> Result<ExternalApiExecuteResponse, AppError> {
            let diagnostics = state.runtime_context.diagnostics.clone();
            let sync = state.runtime_context.sync.clone();
            diagnostics.record_command(stringify!($name), "running", $detail);
            let request = match $builder(input) {
                Ok(request) => request,
                Err(error) => {
                    diagnostics.record_command(stringify!($name), "error", error.to_string());
                    sync.record_failure("external-api", error.to_string());
                    return Err(error);
                }
            };
            let result = execute_external_api(state, request, $scope).await;
            match &result {
                Ok(response) => {
                    diagnostics.record_command(
                        stringify!($name),
                        "ok",
                        format!("status={}", response.status),
                    );
                    sync.record(
                        "external-api",
                        "ready",
                        format!(
                            "{} completed with status {}.",
                            stringify!($name),
                            response.status
                        ),
                        0,
                    );
                }
                Err(error) => {
                    diagnostics.record_command(stringify!($name), "error", error.to_string());
                    sync.record_failure("external-api", error.to_string());
                }
            }
            result
        }
    };
}

async fn execute_external_api(
    state: State<'_, AppState>,
    input: ExternalHttpRequestInput,
    scope: ExternalApiScope,
) -> Result<ExternalApiExecuteResponse, AppError> {
    let policy = external_api_policy(&state, scope);
    let request = external_api::build_web_execute_request_with_policy(input, scope, &policy)?;
    let (status, data) = state.web.execute_external(request).await?;
    if status == -1 {
        return Err(AppError::Custom(data));
    }
    Ok(external_api::execute_response(status, data, scope))
}

external_command!(
    app__external_api_avatar_search_get,
    ExternalApiAvatarSearchInput,
    avatar_search_input,
    ExternalApiScope::AvatarSearch,
    "Searching external avatar provider."
);

external_command!(
    app__external_api_translation_request,
    ExternalApiTranslationInput,
    translation_input,
    ExternalApiScope::Translation,
    "Dispatching external translation request."
);

external_command!(
    app__external_api_youtube_video_metadata_get,
    ExternalApiYoutubeVideoInput,
    youtube_video_input,
    ExternalApiScope::Youtube,
    "Getting YouTube video metadata."
);

external_command!(
    app__external_api_github_releases_get,
    ExternalApiUrlInput,
    github_releases_input,
    ExternalApiScope::UpdateRelease,
    "Getting external update release metadata."
);

external_command!(
    app__external_api_github_contributors_get,
    ExternalApiUrlInput,
    github_contributors_input,
    ExternalApiScope::GithubContributors,
    "Getting GitHub contributors metadata."
);

external_command!(
    app__external_api_image_data_url_get,
    ExternalApiImageInput,
    image_data_url_input,
    ExternalApiScope::Image,
    "Getting external image data."
);
