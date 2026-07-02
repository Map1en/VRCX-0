import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-easy-crop/react-easy-crop.css', () => ({}));

vi.mock('react-easy-crop', async () => {
    const R = await import('react');
    return {
        default: (props: any) =>
            R.createElement('div', {
                'data-testid': 'easy-crop',
                'data-image': props.image
            })
    };
});

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key
    })
}));

vi.mock('@/ui/shadcn/button', async () => {
    const React = await import('react');

    return {
        Button: ({ children, ...props }: any) =>
            React.createElement('button', props, children)
    };
});

vi.mock('@/ui/shadcn/dialog', async () => {
    const React = await import('react');

    return {
        Dialog: ({ children }: any) =>
            React.createElement('div', null, children),
        DialogContent: ({ children }: any) =>
            React.createElement('section', null, children),
        DialogDescription: ({ children }: any) =>
            React.createElement('p', null, children),
        DialogFooter: ({ children }: any) =>
            React.createElement('footer', null, children),
        DialogHeader: ({ children }: any) =>
            React.createElement('header', null, children),
        DialogTitle: ({ children }: any) =>
            React.createElement('h1', null, children)
    };
});

vi.mock('@/ui/shadcn/field', async () => {
    const React = await import('react');

    return {
        Field: ({ children, ...props }: any) =>
            React.createElement('div', props, children),
        FieldGroup: ({ children, ...props }: any) =>
            React.createElement('div', props, children),
        FieldLabel: ({ children, ...props }: any) =>
            React.createElement('label', props, children)
    };
});

vi.mock('@/ui/shadcn/input', async () => {
    const React = await import('react');

    return {
        Input: (props: any) => React.createElement('input', props)
    };
});

vi.mock('@/ui/shadcn/slider', async () => {
    const React = await import('react');

    return {
        Slider: (props: any) => React.createElement('input', props)
    };
});

vi.mock('@/ui/shadcn/checkbox', async () => {
    const React = await import('react');

    return {
        Checkbox: (props: any) =>
            React.createElement('input', {
                ...props,
                type: 'checkbox',
                checked: props.checked
            })
    };
});

vi.mock('lucide-react', async () => {
    const React = await import('react');
    const Icon = (props: any) => React.createElement('span', props);

    return {
        FlipHorizontal2: Icon,
        FlipVertical2: Icon,
        Maximize2: Icon,
        Minimize2: Icon,
        RefreshCcw: Icon,
        RotateCcw: Icon,
        RotateCw: Icon,
        Upload: Icon,
        ZoomIn: Icon,
        ZoomOut: Icon
    };
});

vi.mock('@/ui/shadcn/spinner', async () => {
    const React = await import('react');

    return {
        Spinner: (props: any) => React.createElement('span', props)
    };
});

import { ImageCropDialog } from './ImageCropDialog';

describe('ImageCropDialog', () => {
    it('renders the upload note field only when requested', () => {
        const withoutNote = renderToStaticMarkup(
            React.createElement(ImageCropDialog, {
                open: true,
                file: null,
                aspectRatio: 1
            })
        );
        const withNote = renderToStaticMarkup(
            React.createElement(ImageCropDialog, {
                open: true,
                file: null,
                aspectRatio: 1,
                noteField: {
                    label: 'Print note',
                    placeholder: 'Print note'
                }
            })
        );

        expect(withoutNote).not.toContain('Print note');
        expect(withNote).toContain('Print note');
        expect(withNote).toContain('maxLength="32"');
    });

    it('renders the crop white border field only when requested', () => {
        const withoutCropWhiteBorder = renderToStaticMarkup(
            React.createElement(ImageCropDialog, {
                open: true,
                file: null,
                aspectRatio: 1
            })
        );
        const withCropWhiteBorder = renderToStaticMarkup(
            React.createElement(ImageCropDialog, {
                open: true,
                file: null,
                aspectRatio: 1,
                cropWhiteBorderField: {
                    label: 'Crop white border',
                    defaultChecked: true
                }
            })
        );

        expect(withoutCropWhiteBorder).not.toContain('Crop white border');
        expect(withCropWhiteBorder).toContain('Crop white border');
        expect(withCropWhiteBorder).toContain('checked');
    });
});
