#![allow(non_snake_case)]

use std::collections::HashMap;

use crate::error::AppError;

use super::paths::vrchat_app_data;

#[tauri::command]
pub fn app__get_vrchat_moderations(
    current_user_id: String,
) -> Result<HashMap<String, i16>, AppError> {
    let path = vrchat_app_data()
        .join("LocalPlayerModerations")
        .join(format!("{current_user_id}-show-hide-user.vrcset"));

    if !path.exists() {
        return Ok(HashMap::new());
    }

    let content = std::fs::read_to_string(&path)?;
    let mut result = HashMap::new();
    for line in content.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 2 {
            if let Ok(val) = parts[1].parse::<i16>() {
                result.insert(parts[0].to_string(), val);
            }
        }
    }
    Ok(result)
}

#[tauri::command]
pub fn app__get_vrchat_user_moderation(
    current_user_id: String,
    user_id: String,
) -> Result<i16, AppError> {
    let mods = app__get_vrchat_moderations(current_user_id)?;
    Ok(*mods.get(&user_id).unwrap_or(&0))
}

#[tauri::command]
pub fn app__set_vrchat_user_moderation(
    current_user_id: String,
    user_id: String,
    moderation_type: i32,
) -> Result<bool, AppError> {
    let dir = vrchat_app_data().join("LocalPlayerModerations");
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(format!("{current_user_id}-show-hide-user.vrcset"));

    let mut lines: Vec<String> = if path.exists() {
        std::fs::read_to_string(&path)?
            .lines()
            .map(|l| l.to_string())
            .collect()
    } else {
        Vec::new()
    };

    lines.retain(|line| {
        let parts: Vec<&str> = line.split_whitespace().collect();
        parts.first().map(|&id| id != user_id).unwrap_or(true)
    });

    if moderation_type != 0 {
        lines.push(format!("{user_id} {moderation_type:03}"));
    }

    std::fs::write(&path, lines.join("\n"))?;
    Ok(true)
}
