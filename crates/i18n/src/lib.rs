mod catalog;
mod locale;
mod message;

mod sealed {
    pub trait Sealed {}
}

pub trait CatalogKey: Copy + sealed::Sealed {
    fn as_str(self) -> &'static str;
}

include!(concat!(env!("OUT_DIR"), "/native_keys.rs"));

#[cfg(test)]
mod tests;

pub use catalog::text;
pub use locale::{collapse_whitespace, interpolate, resolve_locale};
pub use message::{render_overlay_message, OverlayMessage};
