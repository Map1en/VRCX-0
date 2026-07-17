use super::*;

#[test]
fn parse_vrc_image_reads_standard_metadata() {
    let metadata = parse_vrc_image(
        r#"ignored prefix
<x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:rdf="rdf" xmlns:vrc="vrc">
  <rdf:RDF>
    <rdf:Description>
      <vrc:CreatorTool>VRChat</vrc:CreatorTool>
      <vrc:Author>Alice Bob</vrc:Author>
      <vrc:AuthorID>usr_author</vrc:AuthorID>
      <vrc:DateTime>2026-07-15T12:34:56Z</vrc:DateTime>
      <rdf:li>Evening meetup</rdf:li>
      <vrc:WorldID>wrld_example:12345</vrc:WorldID>
      <vrc:WorldDisplayName>Example World</vrc:WorldDisplayName>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>"#,
    );

    assert_eq!(metadata.application.as_deref(), Some("VRChat"));
    assert_eq!(metadata.version, 1);
    assert_eq!(metadata.author.id, "usr_author");
    assert_eq!(metadata.author.display_name.as_deref(), Some("Alice Bob"));
    assert_eq!(metadata.timestamp.as_deref(), Some("2026-07-15T12:34:56Z"));
    assert_eq!(metadata.note.as_deref(), Some("Evening meetup"));
    assert_eq!(metadata.world.id, "wrld_example:12345");
    assert_eq!(metadata.world.name.as_deref(), Some("Example World"));
    assert_eq!(metadata.world.instance_id, "wrld_example:12345");
}

#[test]
fn parse_vrc_image_uses_author_as_id_when_author_id_is_missing() {
    let metadata = parse_vrc_image(
        r#"<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <Author>usr_fallback</Author>
</x:xmpmeta>"#,
    );

    assert_eq!(metadata.author.id, "usr_fallback");
    assert_eq!(metadata.author.display_name, None);
}

#[test]
fn parse_vrc_image_handles_malformed_xml_without_panicking() {
    let metadata = parse_vrc_image(
        r#"<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <CreatorTool>VRChat</CreatorTool>
  <Author>Alice</Broken>
</x:xmpmeta>"#,
    );

    assert_eq!(metadata.application.as_deref(), Some("VRChat"));
    assert_eq!(metadata.author.id, "Alice");
    assert_eq!(metadata.author.display_name, None);
}

#[test]
fn parse_lfs_picture_reads_cvr_prefix_and_qualifies_names() {
    let metadata = parse_lfs_picture(
        "LFS|cvr|2|author:cvr_author,Alice|world:cvr_world,instance,Home|players:cvr_player,1,2,3,Bob",
    );

    assert_eq!(metadata.application.as_deref(), Some("cvr"));
    assert_eq!(metadata.version, 2);
    assert_eq!(metadata.author.id, "");
    assert_eq!(
        metadata.author.display_name.as_deref(),
        Some("Alice (cvr_author)")
    );
    assert_eq!(metadata.world.id, "");
    assert_eq!(metadata.world.instance_id, "");
    assert_eq!(metadata.world.name.as_deref(), Some("Home (cvr_world)"));
    assert_eq!(metadata.players.len(), 1);
    assert_eq!(metadata.players[0].id, "");
    assert_eq!(metadata.players[0].display_name, "Bob (cvr_player)");
    assert_eq!(metadata.players[0].pos, Some([1.0, 2.0, 3.0]));
}

#[test]
fn parse_lfs_picture_reads_screenshot_manager_format() {
    let metadata = parse_lfs_picture(
        "screenshotmanager|1|author:usr_author,Alice|wrld_example,12345,Example World",
    );

    assert_eq!(metadata.application.as_deref(), Some("screenshotmanager"));
    assert_eq!(metadata.version, 1);
    assert_eq!(metadata.author.id, "usr_author");
    assert_eq!(metadata.author.display_name.as_deref(), Some("Alice"));
    assert_eq!(metadata.world.id, "wrld_example");
    assert_eq!(metadata.world.instance_id, "wrld_example:12345");
    assert_eq!(metadata.world.name.as_deref(), Some("Example World"));
}

#[test]
fn parse_lfs_picture_v1_world_keeps_only_name() {
    let metadata = parse_lfs_picture("lfs|1|world:Example World");

    assert_eq!(metadata.world.id, "");
    assert_eq!(metadata.world.instance_id, "");
    assert_eq!(metadata.world.name.as_deref(), Some("Example World"));
}

#[test]
fn parse_lfs_picture_v2_reads_world_players_and_position() {
    let metadata = parse_lfs_picture(
        "lfs|2|world:wrld_example,12345,Example World|pos:1.5,-2,3.25|players:usr_alice,4,5,6,Alice;usr_bob,-1,-2,-3,Bob",
    );

    assert_eq!(metadata.world.id, "wrld_example");
    assert_eq!(metadata.world.instance_id, "wrld_example:12345");
    assert_eq!(metadata.world.name.as_deref(), Some("Example World"));
    assert_eq!(metadata.pos, Some([1.5, -2.0, 3.25]));
    assert_eq!(metadata.players.len(), 2);
    assert_eq!(metadata.players[0].id, "usr_alice");
    assert_eq!(metadata.players[0].display_name, "Alice");
    assert_eq!(metadata.players[0].pos, Some([4.0, 5.0, 6.0]));
    assert_eq!(metadata.players[1].id, "usr_bob");
    assert_eq!(metadata.players[1].display_name, "Bob");
    assert_eq!(metadata.players[1].pos, Some([-1.0, -2.0, -3.0]));
}

#[test]
fn parse_lfs_picture_degrades_malformed_coordinates_and_players_safely() {
    let metadata = parse_lfs_picture(
        "lfs|2|pos:not-a-number,2,also-bad|players:usr_valid,bad,5,nope,Alice;incomplete,1,2,3",
    );

    assert_eq!(metadata.pos, Some([0.0, 2.0, 0.0]));
    assert_eq!(metadata.players.len(), 1);
    assert_eq!(metadata.players[0].id, "usr_valid");
    assert_eq!(metadata.players[0].display_name, "Alice");
    assert_eq!(metadata.players[0].pos, Some([0.0, 5.0, 0.0]));
}

#[test]
fn player_helpers_match_exact_ids_and_case_insensitive_name_fragments() {
    let metadata = ScreenshotMetadata {
        players: vec![
            PlayerDetail {
                id: "usr_alice".into(),
                display_name: "Alice Example".into(),
                pos: None,
            },
            PlayerDetail {
                id: "usr_bob".into(),
                display_name: "Bob".into(),
                pos: None,
            },
        ],
        ..Default::default()
    };

    assert!(metadata.contains_player_id("usr_alice"));
    assert!(!metadata.contains_player_id("USR_ALICE"));
    assert!(metadata.contains_player_name("LICe ex"));
    assert!(metadata.contains_player_name("bob"));
    assert!(!metadata.contains_player_name("Carol"));
}
