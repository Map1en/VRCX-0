use std::path::Path;
use std::sync::Arc;

use vrcx_0_application_core::{ConfigStore, Error, Result};
use vrcx_0_application_game::{
    import_game_log_file, inspect_game_log_import_file, GameLogImportConsent, GameLogImportFile,
};
use vrcx_0_core::OwnerId;
use vrcx_0_persistence::DatabaseService;

use crate::game_state_store::PersistenceGameStateStore;

pub(crate) fn inspect_game_log_import(
    owner: &OwnerId,
    paths: &[String],
    game_running: bool,
) -> Result<Vec<GameLogImportFile>> {
    require_owner(owner)?;
    Ok(paths
        .iter()
        .map(|path| inspect_game_log_import_file(Path::new(path), owner.as_str(), game_running))
        .collect())
}

pub(crate) fn import_game_log(
    db: &Arc<DatabaseService>,
    config: &dyn ConfigStore,
    owner: &OwnerId,
    paths: &[String],
    consent: GameLogImportConsent,
    game_running: bool,
) -> Result<Vec<GameLogImportFile>> {
    require_owner(owner)?;
    let store = PersistenceGameStateStore::new(Arc::clone(db));
    let files = paths
        .iter()
        .map(|path| {
            import_game_log_file(
                &store,
                &store,
                config,
                owner,
                Path::new(path),
                consent,
                game_running,
            )
        })
        .collect::<Result<Vec<_>>>()?;
    if files.iter().any(|file| file.inserted_count > 0) {
        vrcx_0_persistence::activity::activity_self_caches_invalidate(db, owner)?;
    }
    Ok(files)
}

fn require_owner(owner: &OwnerId) -> Result<()> {
    if owner.as_str().trim().is_empty() {
        return Err(Error::Custom(
            "Sign in before importing VRChat log files.".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests;
