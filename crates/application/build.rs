fn main() {
    println!("cargo:rerun-if-env-changed=VRCX0_SHARE_OWNER_KEY_SECRET");

    let is_release = std::env::var("PROFILE").as_deref() == Ok("release");
    let secret_present = std::env::var("VRCX0_SHARE_OWNER_KEY_SECRET")
        .map(|value| !value.is_empty())
        .unwrap_or(false);
    if is_release && !secret_present {
        panic!(
            "VRCX0_SHARE_OWNER_KEY_SECRET must be set for release builds. The share-collection \
             owner_key is HMAC(secret, vrchat_user_id) and gates who can edit/delete a published \
             collection; a release binary must not fall back to the public dev placeholder secret, \
             which would let anyone forge management access from a known user id."
        );
    }
}
