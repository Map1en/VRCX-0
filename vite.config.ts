// @ts-nocheck
import fs from 'node:fs';
import { resolve } from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import browserslist from 'browserslist';
import { browserslistToTargets } from 'lightningcss';
import { defineConfig } from 'vite';

function getAssetLanguage(assetId) {
    if (!assetId) return null;

    const language = {
        jp: 'ja',
        sc: 'zh-CN',
        tc: 'zh-TW',
        kr: 'ko'
    }[assetId.split('noto-sans-')[1]?.split('-')[0]];

    return language || null;
}

function getManualChunk(moduleId) {
    const basename = moduleId.split('/').pop();
    const language = getAssetLanguage(basename);
    if (!language) return;

    return `i18n/${language}`;
}

const defaultAssetName = '[name][extname]';
const webview2BuildTarget = {
    vite: 'edge140',
    browserslist: 'Edge 140'
};
const webkitBuildTarget = {
    vite: 'safari17',
    browserslist: 'Safari 17.0'
};

function getPlatformBuildTarget() {
    switch (process.platform) {
        case 'darwin':
        case 'linux':
            return webkitBuildTarget;
        case 'win32':
        default:
            return webview2BuildTarget;
    }
}

function isFont(name) {
    return /\.(woff2?|ttf|otf|eot)$/.test(name);
}

function getAssetFilename({ name }) {
    const language = getAssetLanguage(name);
    if (!language) return `assets/${defaultAssetName}`;

    if (isFont(name)) return 'assets/fonts/[name][extname]';
    return 'assets/i18n/[name][extname]';
}

function createReactDevtoolsStandalonePlugin(enabled) {
    return {
        name: 'vrcx-0-react-devtools-standalone',
        transformIndexHtml() {
            if (!enabled) return;

            return [
                {
                    tag: 'script',
                    attrs: {
                        src: 'http://localhost:8097'
                    },
                    injectTo: 'body-prepend'
                }
            ];
        }
    };
}

export default defineConfig(({ mode }) => {
    const tauriConf = JSON.parse(
        fs.readFileSync(
            new URL('./src-tauri/tauri.conf.json', import.meta.url),
            'utf-8'
        )
    );
    const version = tauriConf.version;
    const buildTarget = getPlatformBuildTarget();
    const enableReactDevtoolsStandalone =
        mode === 'development' && process.env.VITE_REACT_DEVTOOLS === '1';
    const macosSystemFontsEnabled = process.platform === 'darwin';
    const bundledCjkFontsEnabled = !macosSystemFontsEnabled;

    return {
        base: '',
        plugins: [
            createReactDevtoolsStandalonePlugin(enableReactDevtoolsStandalone),
            react(),
            tailwindcss()
        ],
        resolve: {
            alias: {
                '@': resolve(import.meta.dirname, 'src')
            }
        },
        css: {
            transformer: 'lightningcss',
            lightningcss: {
                drafts: {
                    customMedia: true
                },
                errorRecovery: true,
                targets: browserslistToTargets(
                    browserslist(buildTarget.browserslist)
                )
            }
        },
        optimizeDeps: {
            include: [
                '@base-ui/react',
                'i18next',
                'radix-ui',
                'react',
                'react-dom',
                'react-router-dom',
                '@tanstack/react-query',
                'zustand',
                'lucide-react',
                'tailwindcss',
                'graphology',
                'graphology-communities-louvain',
                'graphology-layout-forceatlas2',
                'graphology-layout-noverlap',
                'sigma',
                '@sigma/edge-curve',
                '@sigma/node-border'
            ],
            holdUntilCrawlEnd: false
        },
        define: {
            VERSION: JSON.stringify(version),
            VRCX_0_BUILD_LABEL: JSON.stringify(
                process.env['VRCX_0_BUILD_LABEL'] || ''
            ),
            VRCX_0_BUILD_BADGE: JSON.stringify(
                process.env['VRCX_0_BUILD_BADGE'] || ''
            ),
            VRCX_0_BUNDLED_CJK_FONTS_ENABLED: JSON.stringify(
                bundledCjkFontsEnabled
            ),
            VRCX_0_MACOS_SYSTEM_FONTS_ENABLED: JSON.stringify(
                macosSystemFontsEnabled
            )
        },
        server: {
            port: 9000,
            strictPort: true
        },
        build: {
            target: buildTarget.vite,
            license: {
                fileName: 'licenses/frontend-licenses.json'
            },
            emptyOutDir: true,
            copyPublicDir: true,
            reportCompressedSize: false,
            chunkSizeWarningLimit: 5000,
            sourcemap: false,
            assetsInlineLimit(filePath) {
                if (isFont(filePath)) return 0;
                if (filePath.endsWith('.json')) return 0;
                return 40960;
            },
            rolldownOptions: {
                preserveEntrySignatures: false,
                output: {
                    assetFileNames: getAssetFilename,
                    manualChunks: getManualChunk
                }
            }
        }
    };
});
