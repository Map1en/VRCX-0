use vrcx_0_host_desktop::system_fonts::normalize_font_family_names;

#[test]
fn normalizes_system_font_family_names_for_selection() {
    let names = normalize_font_family_names([
        " Segoe UI ",
        "",
        "@Segoe UI",
        "Noto Sans JP",
        "segoe ui",
        "Arial",
    ]);

    assert_eq!(names, vec!["Arial", "Noto Sans JP", "Segoe UI"]);
}
