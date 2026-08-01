fn main() {
    println!("cargo:rerun-if-changed=ui/overlay.slint");
    println!("cargo:rerun-if-changed=ui/overlay_no_friends_panel.slint");
    println!("cargo:rerun-if-changed=ui/friends_panel.slint");
    println!("cargo:rerun-if-changed=ui/hmd_toast.slint");
    println!("cargo:rerun-if-changed=ui/wrist.slint");
    println!("cargo:rerun-if-changed=ui/avatar_placeholder.slint");
    if std::env::var_os("CARGO_FEATURE_SLINT_UI").is_some() {
        let entry = if std::env::var_os("CARGO_FEATURE_FRIENDS_PANEL").is_some() {
            "ui/overlay.slint"
        } else {
            "ui/overlay_no_friends_panel.slint"
        };
        slint_build::compile(entry).expect("compile Slint overlay UI");
    }
}
