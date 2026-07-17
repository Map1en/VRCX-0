fn main() {
    println!("cargo:rerun-if-changed=ui/overlay.slint");
    println!("cargo:rerun-if-changed=ui/friends_panel.slint");
    println!("cargo:rerun-if-changed=ui/hmd_toast.slint");
    println!("cargo:rerun-if-changed=ui/wrist.slint");
    println!("cargo:rerun-if-changed=ui/avatar_placeholder.slint");
    if std::env::var_os("CARGO_FEATURE_SLINT_UI").is_some() {
        slint_build::compile("ui/overlay.slint").expect("compile Slint overlay UI");
    }
}
