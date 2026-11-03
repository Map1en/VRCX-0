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
fn parse_lfs_picture_preserves_commas_in_names() {
    let screenshot_manager = parse_lfs_picture(
        "screenshotmanager|1|author:usr_author,Alice, Jr.|wrld_example,12345,Example, World",
    );

    assert_eq!(
        screenshot_manager.author.display_name.as_deref(),
        Some("Alice, Jr.")
    );
    assert_eq!(
        screenshot_manager.world.name.as_deref(),
        Some("Example, World")
    );

    let lfs = parse_lfs_picture(
        "lfs|2|author:usr_author,Alice, Jr.|world:wrld_example,12345,Example, World|players:usr_friend,1,2,3,Bob, Sr.",
    );

    assert_eq!(lfs.author.display_name.as_deref(), Some("Alice, Jr."));
    assert_eq!(lfs.world.name.as_deref(), Some("Example, World"));
    assert_eq!(lfs.players[0].display_name, "Bob, Sr.");
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
fn zip_entry_plan_groups_by_source_folder_and_keeps_folder_names_unique() {
    let paths = vec![
        "C:/A/2026-07/a.png".to_string(),
        "C:/A/2026-07/b.png".to_string(),
        "C:/B/2026-07/a.png".to_string(),
    ];

    let plan = plan_screenshot_zip_entries(&paths, true);

    let entries: Vec<&str> = plan.iter().map(|entry| entry.entry_name.as_str()).collect();
    assert_eq!(
        entries,
        vec!["2026-07/a.png", "2026-07/b.png", "2026-07-2/a.png"]
    );
    assert_eq!(plan[2].source_path, "C:/B/2026-07/a.png");
}

#[test]
fn zip_entry_plan_flattens_and_deduplicates_file_names() {
    let paths = vec![
        "C:/A/2026-07/a.png".to_string(),
        "C:/B/2026-05/a.png".to_string(),
        "C:/C/2026-04/a.png".to_string(),
        "C:/D/2026-03/b.png".to_string(),
    ];

    let plan = plan_screenshot_zip_entries(&paths, false);

    let entries: Vec<&str> = plan.iter().map(|entry| entry.entry_name.as_str()).collect();
    assert_eq!(entries, vec!["a.png", "a-2.png", "a-3.png", "b.png"]);
}

#[test]
fn zip_entry_plan_skips_paths_without_a_file_name() {
    let paths = vec!["".to_string(), "C:/A/2026-07/a.png".to_string()];

    let plan = plan_screenshot_zip_entries(&paths, true);

    assert_eq!(plan.len(), 1);
    assert_eq!(plan[0].entry_name, "2026-07/a.png");
}

#[test]
fn export_file_name_is_short_ascii_and_marks_screenshots() {
    let name = screenshot_export_file_name("20260828-1430", 12);

    assert_eq!(name, "VRCX-0-Shots-20260828-1430-12.zip");
    assert!(name.is_ascii());
}

#[test]
fn captured_at_prefers_offset_timestamp_from_vrchat_metadata() {
    let tz = chrono::FixedOffset::east_opt(0).unwrap();
    let captured = captured_at_ms_in(
        &tz,
        Some("2026-09-17T17:49:28.1279419+09:00"),
        "VRChat_2026-09-17_17-49-27.719_3840x2160.png",
        1,
    );

    let expected = chrono::DateTime::parse_from_rfc3339("2026-09-17T08:49:28.127Z")
        .unwrap()
        .timestamp_millis();
    assert_eq!(captured, expected);
}

#[test]
fn captured_at_reads_file_name_as_local_time() {
    let tz = chrono::FixedOffset::east_opt(9 * 3600).unwrap();
    let expected = chrono::DateTime::parse_from_rfc3339("2026-09-17T08:49:27.719Z")
        .unwrap()
        .timestamp_millis();

    assert_eq!(
        captured_at_ms_in(&tz, None, "VRChat_2026-09-17_17-49-27.719_3840x2160.png", 1),
        expected
    );
    assert_eq!(
        captured_at_ms_in(
            &tz,
            Some("not a time"),
            "VRChat_3840x2160_2026-09-17_17-49-27.7190.png",
            1
        ),
        expected
    );
}

#[test]
fn captured_at_falls_back_to_modified_time() {
    let tz = chrono::FixedOffset::east_opt(0).unwrap();

    assert_eq!(captured_at_ms_in(&tz, None, "holiday.png", 42), 42);
}
