// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        i18n: { language: 'en' },
        t: (key: string) => key.split('.').at(-1) || key
    })
}));

vi.mock('../../EntityDialogScaffold', () => ({
    EntityDialogTabContent: ({ children }: { children: ReactNode }) => (
        <div>{children}</div>
    )
}));

import { AvatarDialogPerformanceTab } from './AvatarDialogPerformanceTab';

afterEach(cleanup);

describe('AvatarDialogPerformanceTab', () => {
    it('shows a loading state while detailed analysis is requested', () => {
        render(
            <AvatarDialogPerformanceTab
                platformInfo={{ pc: {}, android: {}, ios: {} }}
                fileAnalysis={{}}
                loading
            />
        );

        expect(screen.getByText('analysis_loading')).toBeTruthy();
    });

    it('explains when detailed analysis is not ready yet', () => {
        render(
            <AvatarDialogPerformanceTab
                platformInfo={{ pc: {}, android: {}, ios: {} }}
                fileAnalysis={{}}
                pending
            />
        );

        expect(screen.getByText('analysis_pending')).toBeTruthy();
    });

    it('renders completed platforms while another platform is pending', () => {
        render(
            <AvatarDialogPerformanceTab
                platformInfo={{
                    pc: { platform: 'standalonewindows' },
                    android: { platform: 'android' },
                    ios: {}
                }}
                fileAnalysis={{
                    standalonewindows: { _fileSize: '12.50 MB' }
                }}
                pending
            />
        );

        expect(screen.getByText('analysis_pending')).toBeTruthy();
        expect(screen.getByText('PC')).toBeTruthy();
        expect(screen.getByText('12.50 MB')).toBeTruthy();
        expect(screen.queryByText('Android')).toBeNull();
    });

    it('renders the platform rating, sizes, and detailed avatar stats', () => {
        render(
            <AvatarDialogPerformanceTab
                platformInfo={{
                    pc: {
                        platform: 'standalonewindows',
                        performanceRating: 'Good'
                    },
                    android: {},
                    ios: {}
                }}
                fileAnalysis={{
                    standalonewindows: {
                        performanceRating: 'VeryPoor',
                        _fileSize: '12.50 MB',
                        _uncompressedSize: '48.25 MB',
                        _totalTextureUsage: '32.00 MB',
                        avatarStats: {
                            totalPolygons: 123456,
                            totalVertices: 65432,
                            raycastCount: 4,
                            particleTrailsEnabled: true,
                            particleCollisionEnabled: false
                        }
                    }
                }}
            />
        );

        expect(screen.getByText('PC')).toBeTruthy();
        expect(screen.getByText('rating: VeryPoor')).toBeTruthy();
        expect(screen.getByText('12.50 MB')).toBeTruthy();
        expect(screen.getByText('48.25 MB')).toBeTruthy();
        expect(screen.getByText('32.00 MB')).toBeTruthy();
        expect(screen.getByText('123,456')).toBeTruthy();
        expect(screen.getByText('65,432')).toBeTruthy();
        expect(screen.getByText('4')).toBeTruthy();
        expect(screen.getAllByText('yes')).toHaveLength(1);
        expect(screen.getAllByText('no')).toHaveLength(1);
    });

    it('keeps the rating visible when detailed analysis is unavailable', () => {
        render(
            <AvatarDialogPerformanceTab
                platformInfo={{
                    pc: {},
                    android: {
                        platform: 'android',
                        performanceRating: 'Medium'
                    },
                    ios: {}
                }}
                fileAnalysis={{}}
            />
        );

        expect(screen.getByText('Android')).toBeTruthy();
        expect(screen.getByText('rating: Medium')).toBeTruthy();
        expect(screen.getByText('analysis_unavailable')).toBeTruthy();
    });
});
