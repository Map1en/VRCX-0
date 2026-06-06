export async function loadBundledCjkFonts(): Promise<void> {
    if (!VRCX_0_BUNDLED_CJK_FONTS_ENABLED) {
        return;
    }

    await import('@fontsource-variable/noto-sans-sc/index.css');
}
