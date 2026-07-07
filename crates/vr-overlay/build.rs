fn main() {
    println!("cargo:rerun-if-changed=ui/overlay.slint");
    println!("cargo:rerun-if-changed=ui/spike.slint");
    println!("cargo:rerun-if-changed=ui/hmd_toast.slint");
    println!("cargo:rerun-if-changed=ui/wrist.slint");
    if std::env::var_os("CARGO_FEATURE_SLINT_SPIKE").is_some() {
        slint_build::compile("ui/spike.slint").expect("compile Slint spike UI");
    } else if std::env::var_os("CARGO_FEATURE_SLINT_UI").is_some() {
        slint_build::compile("ui/overlay.slint").expect("compile Slint overlay UI");
    }
}
