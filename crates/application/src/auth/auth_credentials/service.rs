use serde_json::{json, Value};
use vrcx_0_application_core::WebClient;
use vrcx_0_persistence::config::ConfigRepository;

use super::snapshot::build_saved_auth_snapshot;
use super::storage::{
    get_config_string, normalize_login_params_value, normalize_text, object_field_string,
    read_saved_credentials_map, remove_config_value, set_config_string, value_as_string,
    write_saved_credentials_map, LAST_USER_LOGGED_IN_KEY,
};
use super::types::{LoginSuccessRecordInput, LogoutRecordInput};
use crate::{Error, Result};

pub fn delete_saved_credential(config: &ConfigRepository, user_id: String) -> Result<Value> {
    let user_id = normalize_text(user_id);
    let mut saved_credentials = read_saved_credentials_map(config)?;
    saved_credentials.remove(&user_id);
    write_saved_credentials_map(config, &saved_credentials)?;

    let last_user_logged_in = get_config_string(config, LAST_USER_LOGGED_IN_KEY, "")?;
    if last_user_logged_in == user_id {
        remove_config_value(config, LAST_USER_LOGGED_IN_KEY)?;
    }

    build_saved_auth_snapshot(config)
}

pub fn record_login_success(
    config: &ConfigRepository,
    web: &WebClient,
    input: LoginSuccessRecordInput,
) -> Result<Value> {
    let user_id = object_field_string(&input.user, "id");
    if user_id.is_empty() {
        return Err(Error::Custom(
            "VrchatAuthLoginSuccessRecord requires a user id.".into(),
        ));
    }

    let mut saved_credentials = read_saved_credentials_map(config)?;
    let existing_record = saved_credentials.get(&user_id).cloned();

    if input.save_credentials {
        let login_params = input
            .stored_login_params
            .as_ref()
            .unwrap_or(&input.login_params);
        saved_credentials.insert(
            user_id.clone(),
            json!({
                "user": input.user,
                "loginParams": normalize_login_params_value(login_params),
            }),
        );
    } else if let Some(existing_record) = existing_record {
        let mut record = existing_record.as_object().cloned().unwrap_or_default();
        record.insert("user".into(), input.user);
        let cookies = web.get_cookies();
        if cookies.is_empty() {
            record.remove("cookies");
        } else {
            record.insert("cookies".into(), Value::String(cookies));
        }
        saved_credentials.insert(user_id.clone(), Value::Object(record));
    }

    write_saved_credentials_map(config, &saved_credentials)?;
    set_config_string(config, LAST_USER_LOGGED_IN_KEY, &user_id)?;
    build_saved_auth_snapshot(config)
}

pub fn record_logout(
    config: &ConfigRepository,
    web: &WebClient,
    input: LogoutRecordInput,
) -> Result<Value> {
    let user = input.user_or_user_id.as_object().cloned();
    let user_id = if let Some(user) = user.as_ref() {
        object_field_string(&Value::Object(user.clone()), "id")
    } else {
        value_as_string(Some(&input.user_or_user_id))
    };
    let clear_last_user_logged_in = input
        .clear_last_user_logged_in
        .unwrap_or(!user_id.is_empty());

    if !user_id.is_empty() {
        let mut saved_credentials = read_saved_credentials_map(config)?;
        if let Some(existing_record) = saved_credentials.get(&user_id).cloned() {
            let mut record = existing_record.as_object().cloned().unwrap_or_default();
            if let Some(user) = user {
                record.insert("user".into(), Value::Object(user));
            }

            let cookies = match input.cookies {
                Some(Value::Null) | None => Value::String(web.get_cookies()),
                Some(cookies) => cookies,
            };
            let has_cookies = match &cookies {
                Value::Null => false,
                Value::String(value) => !value.is_empty(),
                _ => true,
            };
            if has_cookies {
                record.insert("cookies".into(), cookies);
            } else {
                record.remove("cookies");
            }

            saved_credentials.insert(user_id.clone(), Value::Object(record));
            write_saved_credentials_map(config, &saved_credentials)?;
        }
    }

    if clear_last_user_logged_in {
        remove_config_value(config, LAST_USER_LOGGED_IN_KEY)?;
    }
    build_saved_auth_snapshot(config)
}

#[cfg(test)]
mod tests;
