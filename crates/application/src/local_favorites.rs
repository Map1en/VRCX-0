use vrcx_0_persistence::favorites;
use vrcx_0_persistence::DatabaseService;

use crate::config::{read_config_string_array, write_config_string_array};
use crate::{Error, Result};

pub(crate) fn local_group_config_key(kind: &str) -> Result<&'static str> {
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
    kind: &str,
    group_name: String,
) -> Result<()> {
    let key = local_group_config_key(kind)?;
    let mut groups = read_config_string_array(db, key)?;
    add_group_value(&mut groups, &group_name);
    write_config_string_array(db, key, &groups)
}

pub fn rename_local_favorite_group(
    db: &DatabaseService,
    kind: &str,
    group_name: String,
    new_group_name: String,
) -> Result<i64> {
    let key = local_group_config_key(kind)?;
    let mut groups = read_config_string_array(db, key)?
        .into_iter()
        .filter(|value| value != &group_name)
        .collect::<Vec<_>>();
    add_group_value(&mut groups, &new_group_name);
    favorites::favorite_group_rename_with_config(
        db,
        kind,
        key,
        &group_name,
        &new_group_name,
        &groups,
    )
    .map_err(Error::from)
}

pub fn delete_local_favorite_group(
    db: &DatabaseService,
    kind: &str,
    group_name: String,
) -> Result<i64> {
    let key = local_group_config_key(kind)?;
    let groups = read_config_string_array(db, key)?
        .into_iter()
        .filter(|value| value != &group_name)
        .collect::<Vec<_>>();
    favorites::favorite_group_delete_with_config(db, kind, key, &group_name, &groups)
        .map_err(Error::from)
}
