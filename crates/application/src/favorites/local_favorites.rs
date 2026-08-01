use vrcx_0_persistence::config::resolve_config_key;
use vrcx_0_persistence::favorites;
use vrcx_0_persistence::favorites::FavoriteRow;
use vrcx_0_persistence::DatabaseService;

use crate::{Error, Result};
use vrcx_0_application_core::{read_config_string_array, write_config_string_array};

#[derive(Clone, Debug, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LocalFavoriteGroupWrite {
    pub config_key: String,
    pub group_names: Vec<String>,
    pub affected: i64,
}

pub fn list_local_favorites(
    db: &DatabaseService,
    owner_user_id: &str,
    kind: String,
) -> Result<Vec<FavoriteRow>> {
    favorites::favorite_list(db, Some(owner_user_id), kind).map_err(Error::from)
}

pub fn add_local_favorite(
    db: &DatabaseService,
    owner_user_id: &str,
    kind: String,
    entity_id: String,
    group_name: String,
) -> Result<i64> {
    favorites::favorite_add(db, Some(owner_user_id), kind, entity_id, group_name)
        .map_err(Error::from)
}

pub fn remove_local_favorite(
    db: &DatabaseService,
    owner_user_id: &str,
    kind: String,
    entity_id: String,
    group_name: String,
) -> Result<i64> {
    favorites::favorite_remove(db, Some(owner_user_id), kind, entity_id, group_name)
        .map_err(Error::from)
}

pub fn rename_local_favorite_entries(
    db: &DatabaseService,
    owner_user_id: &str,
    kind: String,
    group_name: String,
    new_group_name: String,
) -> Result<i64> {
    favorites::favorite_group_rename(db, Some(owner_user_id), kind, group_name, new_group_name)
        .map_err(Error::from)
}

pub fn delete_local_favorite_entries(
    db: &DatabaseService,
    owner_user_id: &str,
    kind: String,
    group_name: String,
) -> Result<i64> {
    favorites::favorite_group_delete(db, Some(owner_user_id), kind, group_name).map_err(Error::from)
}

pub(super) fn local_group_config_key(kind: &str) -> Result<&'static str> {
    match kind.trim() {
        "friend" => Ok("localFavoriteFriendGroups"),
        "avatar" => Ok("localFavoriteAvatarGroups"),
        "world" => Ok("localFavoriteWorldGroups"),
        _ => Err(Error::Custom("unsupported favorite kind".into())),
    }
}

fn add_group_value(groups: &mut Vec<String>, group_name: &str) {
    if groups.iter().any(|value| value == group_name) {
        return;
    }
    groups.push(group_name.to_string());
    groups.sort();
    groups.dedup();
}

pub fn create_local_favorite_group(
    db: &DatabaseService,
    owner_user_id: &str,
    kind: &str,
    group_name: String,
) -> Result<LocalFavoriteGroupWrite> {
    let key = writable_group_config_key(kind, owner_user_id)?;
    let mut groups = read_config_string_array(db, &key)?;
    add_group_value(&mut groups, &group_name);
    write_config_string_array(db, &key, &groups)?;
    Ok(LocalFavoriteGroupWrite {
        config_key: resolve_config_key(&key),
        group_names: groups,
        affected: 0,
    })
}

pub fn rename_local_favorite_group(
    db: &DatabaseService,
    owner_user_id: &str,
    kind: &str,
    group_name: String,
    new_group_name: String,
) -> Result<LocalFavoriteGroupWrite> {
    let key = group_config_realm_key(db, kind, owner_user_id, &group_name)?;
    let mut groups = read_config_string_array(db, &key)?
        .into_iter()
        .filter(|value| value != &group_name)
        .collect::<Vec<_>>();
    add_group_value(&mut groups, &new_group_name);
    let affected = favorites::favorite_group_rename_with_config(
        db,
        Some(owner_user_id),
        kind,
        &key,
        &group_name,
        &new_group_name,
        &groups,
    )
    .map_err(Error::from)?;
    Ok(LocalFavoriteGroupWrite {
        config_key: resolve_config_key(&key),
        group_names: groups,
        affected,
    })
}

pub fn delete_local_favorite_group(
    db: &DatabaseService,
    owner_user_id: &str,
    kind: &str,
    group_name: String,
) -> Result<LocalFavoriteGroupWrite> {
    let key = group_config_realm_key(db, kind, owner_user_id, &group_name)?;
    let groups = read_config_string_array(db, &key)?
        .into_iter()
        .filter(|value| value != &group_name)
        .collect::<Vec<_>>();
    let affected = favorites::favorite_group_delete_with_config(
        db,
        Some(owner_user_id),
        kind,
        &key,
        &group_name,
        &groups,
    )
    .map_err(Error::from)?;
    Ok(LocalFavoriteGroupWrite {
        config_key: resolve_config_key(&key),
        group_names: groups,
        affected,
    })
}

fn writable_group_config_key(kind: &str, owner_user_id: &str) -> Result<String> {
    let base_key = local_group_config_key(kind)?;
    if kind.trim() == "friend" && !owner_user_id.trim().is_empty() {
        Ok(format!("{base_key}:{}", owner_user_id.trim()))
    } else {
        Ok(base_key.to_string())
    }
}

fn group_config_realm_key(
    db: &DatabaseService,
    kind: &str,
    owner_user_id: &str,
    group_name: &str,
) -> Result<String> {
    let account_key = writable_group_config_key(kind, owner_user_id)?;
    if kind.trim() != "friend"
        || read_config_string_array(db, &account_key)?
            .iter()
            .any(|value| value == group_name)
    {
        Ok(account_key)
    } else {
        Ok(local_group_config_key(kind)?.to_string())
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use vrcx_0_application_core::{read_config_string_array, write_config_string_array};
    use vrcx_0_persistence::favorites::{favorite_add, favorite_list};

    use super::*;

    struct TestDir(PathBuf);

    impl TestDir {
        fn new(name: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "vrcx-0-local-favorites-{name}-{}-{nonce}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn friend_group_writes_use_account_or_shared_realm() {
        let dir = TestDir::new("group-realms");
        let db = DatabaseService::new(&dir.0.join("VRCX-0.sqlite3")).unwrap();

        create_local_favorite_group(&db, "usr_a", "friend", "account".into()).unwrap();
        create_local_favorite_group(&db, "", "friend", "legacy".into()).unwrap();
        assert_eq!(
            read_config_string_array(&db, "localFavoriteFriendGroups:usr_a").unwrap(),
            vec!["account"]
        );
        assert_eq!(
            read_config_string_array(&db, "localFavoriteFriendGroups").unwrap(),
            vec!["legacy"]
        );

        favorite_add(
            &db,
            Some("usr_a"),
            "friend".into(),
            "usr_account_friend".into(),
            "account".into(),
        )
        .unwrap();
        favorite_add(
            &db,
            None,
            "friend".into(),
            "usr_legacy_friend".into(),
            "legacy".into(),
        )
        .unwrap();

        rename_local_favorite_group(&db, "usr_a", "friend", "account".into(), "renamed".into())
            .unwrap();
        delete_local_favorite_group(&db, "usr_a", "friend", "legacy".into()).unwrap();

        let groups = favorite_list(&db, Some("usr_a"), "friend".into())
            .unwrap()
            .into_iter()
            .map(|row| row.group_name)
            .collect::<Vec<_>>();
        assert_eq!(groups, vec!["renamed"]);
        assert_eq!(
            read_config_string_array(&db, "localFavoriteFriendGroups:usr_a").unwrap(),
            vec!["renamed"]
        );
        assert!(read_config_string_array(&db, "localFavoriteFriendGroups")
            .unwrap()
            .is_empty());
    }

    #[test]
    fn account_group_rename_does_not_rewrite_shared_rows_with_same_name() {
        let dir = TestDir::new("same-name-realms");
        let db = DatabaseService::new(&dir.0.join("VRCX-0.sqlite3")).unwrap();
        write_config_string_array(&db, "localFavoriteFriendGroups", &["same".into()]).unwrap();
        write_config_string_array(&db, "localFavoriteFriendGroups:usr_a", &["same".into()])
            .unwrap();
        favorite_add(
            &db,
            None,
            "friend".into(),
            "usr_shared".into(),
            "same".into(),
        )
        .unwrap();
        favorite_add(
            &db,
            Some("usr_a"),
            "friend".into(),
            "usr_account".into(),
            "same".into(),
        )
        .unwrap();

        rename_local_favorite_group(&db, "usr_a", "friend", "same".into(), "account-only".into())
            .unwrap();

        let mut rows = favorite_list(&db, Some("usr_a"), "friend".into())
            .unwrap()
            .into_iter()
            .map(|row| (row.user_id.unwrap_or_default(), row.group_name))
            .collect::<Vec<_>>();
        rows.sort();
        assert_eq!(
            rows,
            vec![
                ("usr_account".into(), "account-only".into()),
                ("usr_shared".into(), "same".into()),
            ]
        );
    }
}
