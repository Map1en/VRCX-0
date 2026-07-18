pub fn current_system_theme_category() -> Option<&'static str> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let key = hkcu
            .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize")
            .ok()?;
        let apps_use_light_theme: u32 = key.get_value("AppsUseLightTheme").ok()?;
        Some(if apps_use_light_theme == 0 {
            "dark"
        } else {
            "light"
        })
    }

    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}
