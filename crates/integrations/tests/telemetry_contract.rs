use vrcx_0_integrations::telemetry::resolve_endpoint_for;

#[test]
fn telemetry_endpoint_matches_build_policy() {
    assert_eq!(
        resolve_endpoint_for(
            true,
            Some(" http://127.0.0.1:8097/ "),
            Some("https://compile")
        ),
        "http://127.0.0.1:8097"
    );
    assert_eq!(
        resolve_endpoint_for(true, None, Some("https://compile")),
        ""
    );
    assert_eq!(
        resolve_endpoint_for(false, None, None),
        "https://stats.vrcx-0.dev"
    );
    assert_eq!(
        resolve_endpoint_for(false, None, Some("https://compile.example/")),
        "https://compile.example"
    );
}
