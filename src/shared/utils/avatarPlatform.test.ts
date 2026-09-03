import { describe, expect, it } from 'vitest';

import {
    getAvailablePlatforms,
    getPlatformInfo,
    hasAvatarPerformanceDetails
} from './avatarPlatform';

describe('avatarPlatform', () => {
    it('detects available PC, Quest, and iOS packages from supported variants', () => {
        expect(
            getAvailablePlatforms([
                { platform: 'standalonewindows', variant: 'standard' },
                { platform: 'android', variant: 'security' },
                { platform: 'ios' },
                { platform: 'standalonewindows', variant: 'impostor' },
                null
            ])
        ).toEqual({
            isPC: true,
            isQuest: true,
            isIos: true
        });
    });

    it('returns empty platform flags for non-array or unsupported packages', () => {
        expect(getAvailablePlatforms(null)).toEqual({
            isPC: false,
            isQuest: false,
            isIos: false
        });
        expect(
            getAvailablePlatforms([
                { platform: 'android', variant: 'impostor' },
                { platform: 'linux', variant: 'standard' }
            ])
        ).toEqual({
            isPC: false,
            isQuest: false,
            isIos: false
        });
    });

    it('keeps the best package info and ignores None ratings after a real package exists', () => {
        const pcGood = {
            platform: 'standalonewindows',
            performanceRating: 'Good',
            variant: 'standard'
        };
        const pcNone = {
            platform: 'standalonewindows',
            performanceRating: ' None ',
            variant: 'standard'
        };
        const androidNoneFirst = {
            platform: 'android',
            performanceRating: 'None',
            variant: 'security'
        };
        const androidMedium = {
            platform: 'android',
            performanceRating: 'Medium',
            variant: 'standard'
        };
        const iosUnsupported = {
            platform: 'ios',
            performanceRating: 'Excellent',
            variant: 'impostor'
        };

        expect(
            getPlatformInfo([
                pcGood,
                pcNone,
                androidNoneFirst,
                androidMedium,
                iosUnsupported
            ])
        ).toEqual({
            pc: pcGood,
            android: androidMedium,
            ios: {}
        });
    });

    it('removes whitespace-padded None ratings', () => {
        expect(
            getPlatformInfo([
                {
                    platform: 'standalonewindows',
                    performanceRating: ' None '
                }
            ]).pc
        ).toEqual({ platform: 'standalonewindows' });
    });

    it('falls back through file analysis, package, and avatar ratings', () => {
        expect(
            getPlatformInfo(
                [
                    {
                        platform: 'standalonewindows',
                        performanceRating: 'Good'
                    },
                    { platform: 'android', performanceRating: 'None' }
                ],
                {
                    standalonewindows: 'Poor',
                    android: 'Medium',
                    ios: 'Excellent'
                },
                {
                    standalonewindows: { performanceRating: 'VeryPoor' }
                }
            )
        ).toEqual({
            pc: {
                platform: 'standalonewindows',
                performanceRating: 'VeryPoor'
            },
            android: {
                platform: 'android',
                performanceRating: 'Medium'
            },
            ios: {
                platform: 'ios',
                performanceRating: 'Excellent'
            }
        });
    });

    it('shows performance details only when analysis contains detailed data', () => {
        expect(hasAvatarPerformanceDetails(null)).toBe(false);
        expect(hasAvatarPerformanceDetails({})).toBe(false);
        expect(
            hasAvatarPerformanceDetails({
                standalonewindows: { performanceRating: 'Good' }
            })
        ).toBe(false);
        expect(
            hasAvatarPerformanceDetails({
                standalonewindows: { fileSize: 0 }
            })
        ).toBe(true);
        expect(
            hasAvatarPerformanceDetails({
                android: {
                    avatarStats: {
                        totalPolygons: 0,
                        particleCollisionEnabled: false
                    }
                }
            })
        ).toBe(true);
    });
});
