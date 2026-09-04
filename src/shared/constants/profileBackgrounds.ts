const profileBackgroundAssetUrl =
    'https://assets.vrchat.com/www/profile_decorations/profile_backgrounds/';

const profileBackgroundFileList: Readonly<Record<string, string>> =
    Object.freeze({
        grid: 'BG_Grid.png',
        filigree: 'BG_Cascade.png',
        'bit-mountain': 'BG_GRID_BITS.png',
        approach: 'BG_Approach.png',
        'planet-fall': 'BG_PlanetFall.png',
        jungle: 'BG_Jungle.png',
        'light-streams': 'BG_LightStream.png',
        koi: 'Koi_Layer.png',
        moonlight: 'BG_Cloud.png',
        machine: 'TechWallLayer.png',
        topology: 'TOPOLOGY.png',
        circuit: 'BG_Circuit.png',
        'kawaii-cupcakes': 'BG_Kawaii_cupcakes.png',
        bokeh: 'BG_Bokeh.png',
        hologram: 'BG_Shatter.png',
        flow: 'BG_Flow_Horizontal.png',
        jelly: 'BG_Jelly.png',
        cheese: 'BG_Cheese.png',
        alchemy: 'BG_Alchemy.png',
        'sunset-mountain': 'BG_MountainSun.png',
        'magic-rocks': 'BG_MagicRocks.png',
        'city-stillness': 'BG_FutureCityStillness.png',
        music: 'BG_Music.png',
        'wolf-running': 'BG_WolfRunning.png',
        'dragon-smoke': 'BG_DragonSmoke.png',
        'night-rain': 'BG_NightRain.png',
        'butterfly-zero': 'BG_ButterFlyZERO.png',
        'i-am-speed': 'void.png',
        ronin: 'BG_Ronin.png',
        abduction: 'BG_Abduction.png',
        'cat-dream': 'BG_CatDream.png',
        'virtual-waves': 'BG_VirtualWaves.png',
        'bolt-and-snail': 'BG_BoltNSnail.png',
        escape: 'BG_Escape.png'
    });

function profileBackgroundTextureLabel(textureId: string): string {
    return textureId
        .split('-')
        .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
        .join(' ');
}

const profileBackgroundTextures = Object.entries(profileBackgroundFileList).map(
    ([textureId, fileName]) => ({
        textureId,
        label: profileBackgroundTextureLabel(textureId),
        imageUrl: `${profileBackgroundAssetUrl}${fileName}`
    })
);

export {
    profileBackgroundAssetUrl,
    profileBackgroundFileList,
    profileBackgroundTextureLabel,
    profileBackgroundTextures
};
