import vrcx0RgbCss from '@/styles/vrcx-0-rgb.css?inline';

const RGB = 'vrcx-0-rgb';

export const VRCX_CSS_LAYER_ATTR = 'data-vrcx-0-css-layer';

export const VRCX_CSS_LAYERS = [
    'background-image',
    'installed-theme',
    'local-theme-preview',
    'user-override',
    RGB
] as const;

export type VrcxCssLayer = (typeof VRCX_CSS_LAYERS)[number];

const layerSnapshots: Record<VrcxCssLayer, string> = {
    'background-image': '',
    'installed-theme': '',
    'local-theme-preview': '',
    'user-override': '',
    [RGB]: ''
};
const suppressedLayers = new Set<VrcxCssLayer>();
const RGB_STORAGE_KEY = 'vrcx-0-rgb-enabled';

function isKnownLayer(value: string | null): value is VrcxCssLayer {
    return VRCX_CSS_LAYERS.some((layer) => layer === value);
}

function renderCssLayers(): void {
    if (typeof document === 'undefined') {
        return;
    }

    document
        .querySelectorAll(`style[${VRCX_CSS_LAYER_ATTR}]`)
        .forEach((styleElement) => {
            if (isKnownLayer(styleElement.getAttribute(VRCX_CSS_LAYER_ATTR))) {
                styleElement.remove();
            }
        });

    VRCX_CSS_LAYERS.forEach((layer) => {
        const cssText = layerSnapshots[layer];
        if (suppressedLayers.has(layer) || !cssText.trim()) {
            return;
        }

        const styleElement = document.createElement('style');
        styleElement.setAttribute(VRCX_CSS_LAYER_ATTR, layer);
        styleElement.textContent = cssText;
        document.head.appendChild(styleElement);
    });
}

export function setVrcxCssLayer(layer: VrcxCssLayer, cssText: string): void {
    layerSnapshots[layer] = String(cssText || '');
    renderCssLayers();
}

export function setVrcxCssLayers(
    layers: Partial<Record<VrcxCssLayer, string>>
): void {
    Object.entries(layers).forEach(([layer, cssText]) => {
        if (isKnownLayer(layer)) {
            layerSnapshots[layer] = String(cssText || '');
        }
    });
    renderCssLayers();
}

export function clearVrcxCssLayer(layer: VrcxCssLayer): void {
    setVrcxCssLayer(layer, '');
}

export function setVrcxCssLayersSuppressed(
    layers: VrcxCssLayer[],
    suppressed: boolean
): void {
    layers.forEach((layer) => {
        if (suppressed) {
            suppressedLayers.add(layer);
            return;
        }
        suppressedLayers.delete(layer);
    });
    renderCssLayers();
}

function applyRgb(enabled: boolean): void {
    document.documentElement.classList.toggle(RGB, enabled);
    setVrcxCssLayer(RGB, enabled ? vrcx0RgbCss : '');
}

export function setRgb(enabled: boolean): void {
    applyRgb(enabled);
    try {
        if (enabled) {
            localStorage.setItem(RGB_STORAGE_KEY, 'true');
        } else {
            localStorage.removeItem(RGB_STORAGE_KEY);
        }
    } catch {}
}

try {
    applyRgb(localStorage.getItem(RGB_STORAGE_KEY) === 'true');
} catch {
    applyRgb(false);
}
