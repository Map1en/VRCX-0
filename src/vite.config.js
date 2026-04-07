import { resolve } from 'node:path';

import fs from 'node:fs';

import { defineConfig } from 'vite';
import { browserslistToTargets } from 'lightningcss';

import browserslist from 'browserslist';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import vueJsx from '@vitejs/plugin-vue-jsx';

import { languageCodes } from './localization/locales';

/**
 * Vite plugin to remove legacy remixicon font files (eot, woff, ttf, svg)
 * from the build output, keeping only woff2. Saves ~4.5 MB.
 *
 * Chrome 144 picks woff2 from the multi-format @font-face src list and
 * never requests the other formats, so deleting them is safe.
 *
 * @returns {import('vite').Plugin}
 */
function remixiconWoff2Only() {
    return {
        name: 'remixicon-woff2-only',
        generateBundle(_, bundle) {
            for (const key of Object.keys(bundle)) {
                if (/remixicon\.(eot|ttf|svg|woff)$/.test(key)) {
                    delete bundle[key];
                }
            }
        }
    };
}

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
        fs.readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf-8')
    );
    const version = tauriConf.version;

    return {
        base: '',
        plugins: [
            remixiconWoff2Only(),
            vue(),
            vueJsx({
                tsTransform: 'built-in'
            }),
            tailwindcss()
        ],
        resolve: {
            alias: {
                '@': resolve(import.meta.dirname, '.')
            }
        },
        css: {
            transformer: 'lightningcss',
            lightningcss: {
                drafts: {
                    customMedia: true
                },
                errorRecovery: true,
                targets: browserslistToTargets(browserslist('Chrome 125'))
            }
        },
        optimizeDeps: {
            include: [
                'vue',
                'vue/jsx-runtime',
                'reka-ui',
                'pinia',
                'vue-i18n',
                'tailwindcss',
                'lucide-vue-next',
                '@vueuse/core',
                'vue-sonner',
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
            target: 'chrome111',
            outDir: '../build/html',
            license: true,
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
                input: {
                    index: resolve(import.meta.dirname, './index.html')
                },
                output: {
                    assetFileNames: getAssetFilename,
                    manualChunks: getManualChunk
                }
            }
        }
    };
});
