use vrcx_0_application_core::RuntimeOperationStatus;

use vrcx_0_application::auth::{
    AutoLoginOutcome, AutoLoginStartInput, LoginSessionCancelInput, LoginSessionEnd,
    LoginSessionRespondInput, LoginSessionStartInput, LoginSessionState, SavedAuthSnapshot,
};
use vrcx_0_composition::Result;

use super::DesktopRuntimeHostState;

impl DesktopRuntimeHostState {
    pub fn require_active_scope(
        &self,
        requirement: &str,
    ) -> Result<vrcx_0_application_core::RuntimeAuthScopeSnapshot> {
        let scope = self.auth_scope_snapshot();
        if scope.active && !scope.current_user_id.trim().is_empty() {
            Ok(scope)
        } else {
            Err(vrcx_0_application_core::Error::Custom(format!(
                "{requirement} requires an authenticated session."
            ))
            .into())
        }
    }

    pub fn saved_auth_snapshot(&self) -> Result<SavedAuthSnapshot> {
        Ok(vrcx_0_application::auth::saved_snapshot(
            self.runtime.desktop_assembly().auth_credentials(),
        )?)
    }

    pub fn delete_saved_credential(&self, user_id: String) -> Result<SavedAuthSnapshot> {
        Ok(vrcx_0_application::auth::delete_saved_credential(
            self.runtime.desktop_assembly().auth_credentials(),
            user_id,
        )?)
    }

    pub fn clear_saved_password(&self, user_id: String) -> Result<SavedAuthSnapshot> {
        Ok(vrcx_0_application::auth::clear_saved_password(
            self.runtime.desktop_assembly().auth_credentials(),
            user_id,
        )?)
    }

    pub async fn start_login_session(&self, input: LoginSessionStartInput) -> LoginSessionState {
        let diagnostics = self.runtime.desktop_assembly().diagnostics();
        diagnostics.record_command(
            "app__vrchat_auth_session_start",
            RuntimeOperationStatus::Running,
            "Starting a VRChat login session.",
        );
        let result = self.runtime.start_login_session(input).await;
        diagnostics.record_command(
            "app__vrchat_auth_session_start",
            RuntimeOperationStatus::Ok,
            format!("status={result:?}"),
        );
        result
    }

    pub async fn start_auto_login(&self, input: AutoLoginStartInput) -> Result<AutoLoginOutcome> {
        let diagnostics = self.runtime.desktop_assembly().diagnostics();
        diagnostics.record_command(
            "app__vrchat_auth_auto_login_start",
            RuntimeOperationStatus::Running,
            "Starting an automatic VRChat login attempt.",
        );
        let result = self.runtime.start_auto_login(input).await;
        match &result {
            Ok(outcome) => diagnostics.record_command(
                "app__vrchat_auth_auto_login_start",
                RuntimeOperationStatus::Ok,
                format!("status={outcome:?}"),
            ),
            Err(error) => diagnostics.record_command(
                "app__vrchat_auth_auto_login_start",
                RuntimeOperationStatus::Error,
                error.to_string(),
            ),
        }
        result
    }

    pub async fn respond_login_session(
        &self,
        input: LoginSessionRespondInput,
    ) -> LoginSessionState {
        self.runtime.respond_login_session(input).await
    }

    pub async fn cancel_login_session(&self, input: LoginSessionCancelInput) -> LoginSessionState {
        self.runtime.cancel_login_session(input).await
    }

    pub async fn end_login_session(
        &self,
        input: LoginSessionEnd,
    ) -> Result<Option<SavedAuthSnapshot>> {
        self.runtime.end_login_session(input).await
    }

    pub fn active_owner_id(&self) -> Option<vrcx_0_core::OwnerId> {
        let auth_scope = self.runtime.desktop_assembly().auth_scope().snapshot();
        auth_scope
            .active
            .then(|| vrcx_0_core::OwnerId::new(auth_scope.current_user_id))
    }

    pub fn auth_scope_snapshot(&self) -> vrcx_0_application_core::RuntimeAuthScopeSnapshot {
        self.runtime.desktop_assembly().auth_scope().snapshot()
    }
}
