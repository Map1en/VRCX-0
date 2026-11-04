use vrcx_0_application_core::{ConfigStore, MemoryConfigStore};

use super::{
    is_desktop_widget_config_key, place_on_screens, DesktopWidgetBounds, DesktopWidgetSettings,
    DESKTOP_WIDGET_CLICK_THROUGH_CONFIG_KEY, DESKTOP_WIDGET_NEWEST_ON_TOP_CONFIG_KEY,
    DESKTOP_WIDGET_OPACITY_CONFIG_KEY, DESKTOP_WIDGET_PINNED_CONFIG_KEY,
};

#[test]
fn a_new_widget_is_off_pinned_clickable_half_see_through_and_lists_newest_on_top() {
    let config = MemoryConfigStore::default();

    let settings = DesktopWidgetSettings::load(&config);

    assert!(!settings.enabled);
    assert!(settings.pinned);
    assert!(!settings.click_through);
    assert_eq!(settings.background_opacity, 55);
    assert!(settings.newest_on_top);
    assert_eq!(settings.bounds, None);
}

#[test]
fn settings_written_from_the_settings_page_are_recognised_as_desktop_overlay_settings() {
    for key in [
        "config:vrcx_desktopwidgetnewestontop",
        "config:vrcx_desktopwidgetopacity",
        "desktopWidgetNewestOnTop",
        "VRCX_desktopWidgetOpacity",
        "appLanguage",
        "VRCX_showInstanceIdInLocation",
    ] {
        assert!(is_desktop_widget_config_key(key), "{key}");
    }
    for key in [
        "config:vrcx_hmdnotificationopacity",
        "config:vrcx_desktopnotificationavatars",
        "hmdNotificationOpacity",
    ] {
        assert!(!is_desktop_widget_config_key(key), "{key}");
    }
}

#[test]
fn turning_on_click_through_also_pins_the_widget() {
    let config = MemoryConfigStore::default();
    let mut settings = DesktopWidgetSettings::load(&config);
    settings.set_pinned(false);

    settings.set_click_through(true);

    assert!(settings.click_through);
    assert!(settings.pinned);
}

#[test]
fn unpinning_also_turns_click_through_off() {
    let config = MemoryConfigStore::default();
    let mut settings = DesktopWidgetSettings::load(&config);
    settings.set_click_through(true);

    settings.set_pinned(false);

    assert!(!settings.pinned);
    assert!(!settings.click_through);
}

#[test]
fn the_widget_comes_back_the_same_after_a_restart() {
    let config = MemoryConfigStore::default();
    config
        .set_string(DESKTOP_WIDGET_OPACITY_CONFIG_KEY, "0")
        .unwrap();
    config
        .set_bool(DESKTOP_WIDGET_NEWEST_ON_TOP_CONFIG_KEY, false)
        .unwrap();
    let mut settings = DesktopWidgetSettings::load(&config);
    settings.enabled = true;
    settings.set_click_through(true);
    settings.bounds = Some(bounds(100, 200, 300, 400));
    settings.save(&config).unwrap();

    let reopened = DesktopWidgetSettings::load(&config.clone());

    assert_eq!(reopened, settings);
}

#[test]
fn a_click_through_widget_is_always_pinned_even_if_saved_otherwise() {
    let config = MemoryConfigStore::default();
    config
        .set_bool(DESKTOP_WIDGET_CLICK_THROUGH_CONFIG_KEY, true)
        .unwrap();
    config
        .set_bool(DESKTOP_WIDGET_PINNED_CONFIG_KEY, false)
        .unwrap();

    let settings = DesktopWidgetSettings::load(&config);

    assert!(settings.click_through);
    assert!(settings.pinned);
}

#[test]
fn background_opacity_stays_within_zero_to_one_hundred() {
    let config = MemoryConfigStore::default();
    config
        .set_string(DESKTOP_WIDGET_OPACITY_CONFIG_KEY, "250")
        .unwrap();

    assert_eq!(DesktopWidgetSettings::load(&config).background_opacity, 100);
}

#[test]
fn first_run_puts_the_widget_near_the_top_right_of_the_main_screen() {
    let primary = bounds(0, 0, 1920, 1040);

    let placed = place_on_screens(None, &[primary], primary, 1.0);

    assert!(placed.x + placed.width <= primary.width);
    assert!(placed.x > primary.width / 2);
    assert!(placed.y < primary.height / 2);
    assert!(placed.width >= 200 && placed.height >= 120);
}

#[test]
fn first_run_size_follows_display_scaling() {
    let primary = bounds(0, 0, 3840, 2080);

    let normal = place_on_screens(None, &[primary], primary, 1.0);
    let scaled = place_on_screens(None, &[primary], primary, 2.0);

    assert_eq!(scaled.width, normal.width * 2);
    assert_eq!(scaled.height, normal.height * 2);
}

#[test]
fn a_saved_spot_on_a_second_screen_is_kept() {
    let primary = bounds(0, 0, 1920, 1040);
    let second = bounds(1920, 0, 2560, 1400);
    let saved = bounds(2400, 300, 320, 240);

    assert_eq!(
        place_on_screens(Some(saved), &[primary, second], primary, 1.0),
        saved
    );
}

#[test]
fn a_widget_left_on_an_unplugged_screen_returns_to_the_main_screen_with_its_size() {
    let primary = bounds(0, 0, 1920, 1040);
    let saved = bounds(2400, 300, 360, 280);

    let placed = place_on_screens(Some(saved), &[primary], primary, 1.0);

    assert_eq!((placed.width, placed.height), (360, 280));
    assert!(placed.x >= 0 && placed.x + placed.width <= primary.width);
    assert!(placed.y >= 0 && placed.y + placed.height <= primary.height);
}

#[test]
fn a_widget_dragged_almost_off_screen_returns_to_the_main_screen() {
    let primary = bounds(0, 0, 1920, 1040);
    let saved = bounds(1910, 1030, 320, 240);

    let placed = place_on_screens(Some(saved), &[primary], primary, 1.0);

    assert_ne!(placed, saved);
    assert!(placed.x + placed.width <= primary.width);
}

fn bounds(x: i32, y: i32, width: i32, height: i32) -> DesktopWidgetBounds {
    DesktopWidgetBounds {
        x,
        y,
        width,
        height,
    }
}
