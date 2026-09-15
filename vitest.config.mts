import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

const coverageExcludedPureConstants = [
    'src/shared/constants/accessType.ts',
    'src/shared/constants/dashboard.ts',
    'src/shared/constants/emoji.ts',
    'src/shared/constants/language.ts',
    'src/shared/constants/link.ts',
    'src/shared/constants/moderation.ts',
    'src/shared/constants/profileBackgrounds.ts',
    'src/shared/constants/settings.ts',
    'src/shared/constants/themes.ts',
    'src/shared/constants/time.ts',
    'src/shared/constants/ui.ts',
    'src/shared/constants/user.ts'
];

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@': resolve(import.meta.dirname, 'src')
        }
    },
    test: {
        environment: 'node',
        exclude: [...configDefaults.exclude, '.claude/**'],
        coverage: {
            include: ['src/**/*.{ts,tsx}'],
            exclude: [
                'src/**/*.test.{ts,tsx}',
                'src/**/*.d.ts',
                'src/localization/**',
                'src/platform/tauri/bindings.ts',
                ...coverageExcludedPureConstants
            ],
            provider: 'v8',
            reporter: ['text', 'json-summary'],
            reportsDirectory: './coverage',
            thresholds: {
                statements: 36,
                branches: 34,
                functions: 32,
                lines: 37,
                'src/app/**': {
                    statements: 7,
                    branches: 15,
                    functions: 6,
                    lines: 7
                },
                'src/components/**': {
                    statements: 25,
                    branches: 25,
                    functions: 22,
                    lines: 25
                },
                'src/domain/**': {
                    statements: 87,
                    branches: 79,
                    functions: 85,
                    lines: 87
                },
                'src/features/**': {
                    statements: 29,
                    branches: 28,
                    functions: 25,
                    lines: 30
                },
                'src/lib/**': {
                    statements: 51,
                    branches: 45,
                    functions: 50,
                    lines: 51
                },
                'src/platform/**': {
                    statements: 78,
                    branches: 77,
                    functions: 76,
                    lines: 78
                },
                'src/repositories/**': {
                    statements: 43,
                    branches: 36,
                    functions: 40,
                    lines: 43
                },
                'src/services/**': {
                    statements: 67,
                    branches: 58,
                    functions: 66,
                    lines: 67
                },
                'src/shared/**': {
                    statements: 78,
                    branches: 74,
                    functions: 80,
                    lines: 78
                },
                'src/shared/utils/**': {
                    statements: 79,
                    branches: 75,
                    functions: 83,
                    lines: 79
                },
                'src/state/**': {
                    statements: 74,
                    branches: 63,
                    functions: 79,
                    lines: 74
                },
                'src/ui/**': {
                    statements: 39,
                    branches: 31,
                    functions: 34,
                    lines: 39
                }
            }
        }
    }
});
