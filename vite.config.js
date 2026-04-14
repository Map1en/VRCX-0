import { resolve } from 'node:path';

import fs from 'node:fs';

import { defineConfig } from 'vite';
import { browserslistToTargets } from 'lightningcss';

import browserslist from 'browserslist';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';

import { languageCodes } from './src/localization/locales';

/**
 *
 * @param assetId
 */
function getAssetLanguage(assetId) {
    if (!assetId) return null;

    if (assetId.endsWith('.json')) {
        const language = assetId.split('.json')[0];

        if (languageCodes.includes(language)) return language;
    }

    const language =
        // Font assets, e.g., noto-sans-jp-regular.woff2 mapped to language code.
        {
            jp: 'ja',
            sc: 'zh-CN',
            tc: 'zh-TW',
            kr: 'ko'
        }[assetId.split('noto-sans-')[1]?.split('-')[0]];

    return language || null;
}

/**
 *
 * @param moduleId
 */
function getManualChunk(moduleId) {
    const basename = moduleId.split('/').pop();
    const language = getAssetLanguage(basename);
    if (!language) return;

    return `i18n/${language}`;
}

const defaultAssetName = '[name][extname]';

/**
 * @param {string} name
 */
function isFont(name) {
    return /\.(woff2?|ttf|otf|eot)$/.test(name);
}

/**
 *
 * @param {import('rolldown').PreRenderedAsset} assetInfo
 */
function getAssetFilename({ name }) {
    const language = getAssetLanguage(name);
    if (!language) return `assets/${defaultAssetName}`;

    if (isFont(name)) return 'assets/fonts/[name][extname]';
    return 'assets/i18n/[name][extname]';
}

export default defineConfig(() => {
    const tauriConf = JSON.parse(
        fs.readFileSync(new URL('./src-tauri/tauri.conf.json', import.meta.url), 'utf-8')
    );
    const version = tauriConf.version;

    return {
        base: '',
        plugins: [
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
                targets: browserslistToTargets(browserslist('Edge 130'))
            }
        },
        optimizeDeps: {
            include: [
                'react',
                'react/jsx-runtime',
                'react-dom',
                'react-router-dom',
                '@tanstack/react-query',
                '@tanstack/react-table',
                'zustand',
                'sonner',
                'lucide-react',
                'tailwindcss',
                'dayjs'
            ]
        },
        define: {
            VERSION: JSON.stringify(version)
        },
        server: {
            port: 9000,
            strictPort: true
        },
        build: {
            target: 'edge130',
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
