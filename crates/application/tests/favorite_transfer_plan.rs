use vrcx_0_application::{
    favorite_transfer_plan_for_item, FavoriteTransferInput, FavoriteTransferItem,
    FavoriteTransferLocation, FavoriteTransferMode, FavoriteTransferSource, FavoriteTransferStage,
    FavoriteTransferTarget,
};

fn transfer_input(
    source: FavoriteTransferLocation,
    target: FavoriteTransferLocation,
    mode: FavoriteTransferMode,
) -> FavoriteTransferInput {
    FavoriteTransferInput {
        endpoint: "https://api.vrchat.cloud/api/1".to_string(),
        kind: "world".to_string(),
        mode,
        source: FavoriteTransferSource {
            location: source,
            group: "source".to_string(),
        },
        target: FavoriteTransferTarget {
            location: target,
            group: "target".to_string(),
            favorite_type: "world".to_string(),
        },
        items: vec![],
    }
}

fn item(entity_id: &str) -> FavoriteTransferItem {
    FavoriteTransferItem {
        key: "remote:source:wrld_1".to_string(),
        entity_id: entity_id.to_string(),
        entity: None,
    }
}

fn stages(input: FavoriteTransferInput, item: FavoriteTransferItem) -> Vec<FavoriteTransferStage> {
    favorite_transfer_plan_for_item(&input, &item).unwrap()
}

#[test]
fn remote_to_remote_move_deletes_before_adding_to_target_group() {
    assert_eq!(
        stages(
            transfer_input(
                FavoriteTransferLocation::Remote,
                FavoriteTransferLocation::Remote,
                FavoriteTransferMode::Move,
            ),
            item("wrld_1"),
        ),
        vec![
            FavoriteTransferStage::DeleteRemote,
            FavoriteTransferStage::AddRemote
        ]
    );
}

#[test]
fn remote_to_remote_copy_is_rejected() {
    let result = favorite_transfer_plan_for_item(
        &transfer_input(
            FavoriteTransferLocation::Remote,
            FavoriteTransferLocation::Remote,
            FavoriteTransferMode::Copy,
        ),
        &item("wrld_1"),
    );

    assert!(result
        .unwrap_err()
        .to_string()
        .contains("only one favorite record"));
}

#[test]
fn remote_to_local_move_adds_local_before_deleting_remote() {
    assert_eq!(
        stages(
            transfer_input(
                FavoriteTransferLocation::Remote,
                FavoriteTransferLocation::Local,
                FavoriteTransferMode::Move,
            ),
            item("wrld_1"),
        ),
        vec![
            FavoriteTransferStage::AddLocal,
            FavoriteTransferStage::DeleteRemote
        ]
    );
}

#[test]
fn remote_to_local_copy_only_adds_local() {
    assert_eq!(
        stages(
            transfer_input(
                FavoriteTransferLocation::Remote,
                FavoriteTransferLocation::Local,
                FavoriteTransferMode::Copy,
            ),
            item("wrld_1"),
        ),
        vec![FavoriteTransferStage::AddLocal]
    );
}

#[test]
fn local_to_remote_move_adds_remote_then_deletes_local() {
    assert_eq!(
        stages(
            transfer_input(
                FavoriteTransferLocation::Local,
                FavoriteTransferLocation::Remote,
                FavoriteTransferMode::Move,
            ),
            item("wrld_1"),
        ),
        vec![
            FavoriteTransferStage::AddRemote,
            FavoriteTransferStage::DeleteLocal
        ]
    );
}

#[test]
fn local_to_remote_copy_only_adds_remote() {
    assert_eq!(
        stages(
            transfer_input(
                FavoriteTransferLocation::Local,
                FavoriteTransferLocation::Remote,
                FavoriteTransferMode::Copy,
            ),
            item("wrld_1"),
        ),
        vec![FavoriteTransferStage::AddRemote]
    );
}

#[test]
fn local_to_local_move_uses_single_local_move_stage() {
    assert_eq!(
        stages(
            transfer_input(
                FavoriteTransferLocation::Local,
                FavoriteTransferLocation::Local,
                FavoriteTransferMode::Move,
            ),
            item("wrld_1"),
        ),
        vec![FavoriteTransferStage::MoveLocal]
    );
}

#[test]
fn local_to_local_copy_only_adds_local() {
    assert_eq!(
        stages(
            transfer_input(
                FavoriteTransferLocation::Local,
                FavoriteTransferLocation::Local,
                FavoriteTransferMode::Copy,
            ),
            item("wrld_1"),
        ),
        vec![FavoriteTransferStage::AddLocal]
    );
}

#[test]
fn remote_source_requires_entity_id() {
    let result = favorite_transfer_plan_for_item(
        &transfer_input(
            FavoriteTransferLocation::Remote,
            FavoriteTransferLocation::Local,
            FavoriteTransferMode::Move,
        ),
        &item(" "),
    );

    assert!(result.unwrap_err().to_string().contains("entity id"));
}

#[test]
fn target_group_must_not_be_empty() {
    let mut input = transfer_input(
        FavoriteTransferLocation::Local,
        FavoriteTransferLocation::Remote,
        FavoriteTransferMode::Copy,
    );
    input.target.group = " ".to_string();

    let result = favorite_transfer_plan_for_item(&input, &item("wrld_1"));

    assert!(result.unwrap_err().to_string().contains("target group"));
}

#[test]
fn exact_same_local_group_is_rejected() {
    let mut input = transfer_input(
        FavoriteTransferLocation::Local,
        FavoriteTransferLocation::Local,
        FavoriteTransferMode::Move,
    );
    input.target.group = "source".to_string();

    let result = favorite_transfer_plan_for_item(&input, &item("wrld_1"));

    assert!(result
        .unwrap_err()
        .to_string()
        .contains("same favorite group"));
}

#[test]
fn exact_same_local_group_is_rejected_for_copy_too() {
    let mut input = transfer_input(
        FavoriteTransferLocation::Local,
        FavoriteTransferLocation::Local,
        FavoriteTransferMode::Copy,
    );
    input.target.group = "source".to_string();

    let result = favorite_transfer_plan_for_item(&input, &item("wrld_1"));

    assert!(result
        .unwrap_err()
        .to_string()
        .contains("same favorite group"));
}
