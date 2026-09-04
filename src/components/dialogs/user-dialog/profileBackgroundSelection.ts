import type { ProfileBackgroundUpdate } from '@/repositories/userProfileRepository';
import {
    profileBackgroundTextureLabel,
    profileBackgroundTextures
} from '@/shared/constants/profileBackgrounds';

import { normalizeProfileAppearanceColor } from './userDialogProfileAppearance';
import type { UserDialogProfileRecord } from './userDialogProfileTypes';

export const DEFAULT_PROFILE_GRADIENT_TOP = '#5d3f86';
export const DEFAULT_PROFILE_GRADIENT_BOTTOM = '#21385b';

export { profileBackgroundTextureLabel };

export function profileBackgroundTextureRequiresVrcPlus(
    textureId: string
): boolean {
    return textureId !== 'grid';
}

export function isProfileBackgroundTextureAvailable(
    textureId: string,
    isVrcPlus: boolean
): boolean {
    return !profileBackgroundTextureRequiresVrcPlus(textureId) || isVrcPlus;
}

export const PROFILE_BACKGROUND_TEXTURES = profileBackgroundTextures.map(
    (texture) => ({
        ...texture,
        requiresVrcPlus: profileBackgroundTextureRequiresVrcPlus(
            texture.textureId
        )
    })
);

export function resolveProfileGradientColors(
    profile: UserDialogProfileRecord
): { bottom: string; top: string } {
    return {
        top:
            normalizeProfileAppearanceColor(profile.backgroundGradientTop) ||
            DEFAULT_PROFILE_GRADIENT_TOP,
        bottom:
            normalizeProfileAppearanceColor(profile.backgroundGradientBottom) ||
            DEFAULT_PROFILE_GRADIENT_BOTTOM
    };
}

export function buildGradientBackgroundUpdate(
    top: string,
    bottom: string
): ProfileBackgroundUpdate {
    return {
        backgroundType: 'gradient',
        backgroundGradientTop: top.replace(/^#/, ''),
        backgroundGradientBottom: bottom.replace(/^#/, '')
    };
}
