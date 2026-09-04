import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    readBaseManifest,
    releaseAssetUrl,
    validateTarget
} from './create-tauri-updater-manifest';
import {
    createThirdPartyNoticeText,
    normalizeFrontendEntry,
    parseCargoMetadata,
    sanitizeId
} from './generate-third-party-licenses';
import { buildReleaseMeta } from './prepare-release-version';

const temporaryDirectories: string[] = [];

function createTemporaryDirectory(): string {
    const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), 'vrcx-0-release-script-')
    );
    temporaryDirectories.push(directory);
    return directory;
}

function releaseScriptEnvironment(): NodeJS.ProcessEnv {
    const environment = { ...process.env };
    delete environment.GITHUB_OUTPUT;
    return environment;
}

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe('prepare-release-version', () => {
    it('builds stable and beta metadata without changing manifests', () => {
        expect(buildReleaseMeta('v2.31.4-beta.2')).toEqual({
            base_version: '2.31.4',
            build_version: '2.31.4-beta.2',
            channel: 'beta',
            prerelease: 'true',
            beta_number: '2',
            display_version: '2.31.4-beta.2',
            tag: 'v2.31.4-beta.2'
        });
        expect(buildReleaseMeta('2.31.4')).toMatchObject({
            channel: 'stable',
            prerelease: 'false',
            beta_number: ''
        });
        expect(() => buildReleaseMeta('2.31.4-preview.2')).toThrow(
            'Invalid release version: 2.31.4-preview.2'
        );
        expect(() => buildReleaseMeta('2.031.4')).toThrow(
            'Invalid release version: 2.031.4'
        );
    });

    it('preserves the command line dry-run output contract', () => {
        const result = spawnSync(
            process.execPath,
            [
                path.join(import.meta.dirname, 'prepare-release-version.ts'),
                '--version',
                'v2.31.4-beta.2',
                '--dry-run'
            ],
            { encoding: 'utf8', env: releaseScriptEnvironment() }
        );

        expect(result.status).toBe(0);
        expect(result.stderr).toBe('');
        expect(result.stdout.trim().split(/\r?\n/)).toEqual([
            'base_version=2.31.4',
            'build_version=2.31.4-beta.2',
            'channel=beta',
            'prerelease=true',
            'beta_number=2',
            'display_version=2.31.4-beta.2',
            'tag=v2.31.4-beta.2'
        ]);
    });
});

describe('create-tauri-updater-manifest', () => {
    it('validates supported targets and encodes release asset URLs', () => {
        expect(() => validateTarget('windows-x86_64-stable')).not.toThrow();
        expect(() => validateTarget('linux-x86_64-deb-stable')).not.toThrow();
        expect(() => validateTarget('macos-aarch64-stable')).not.toThrow();
        expect(() => validateTarget('windows-aarch64-stable')).toThrow(
            'Invalid updater target: windows-aarch64-stable'
        );
        expect(releaseAssetUrl('v2.31.4 preview', 'VRCX 0.exe')).toBe(
            'https://github.com/Map1en/VRCX-0/releases/download/v2.31.4%20preview/VRCX%200.exe'
        );
    });

    it('keeps existing platform entries when reading a base manifest', () => {
        const directory = createTemporaryDirectory();
        const basePath = path.join(directory, 'base.json');
        fs.writeFileSync(
            basePath,
            JSON.stringify({
                version: '2.31.4',
                notes: 'Existing notes',
                platforms: {
                    'windows-x86_64-stable': {
                        signature: 'windows-signature',
                        url: 'https://example.test/windows'
                    }
                }
            })
        );

        expect(readBaseManifest(basePath, '2.31.4')).toMatchObject({
            version: '2.31.4',
            notes: 'Existing notes',
            platforms: {
                'windows-x86_64-stable': {
                    signature: 'windows-signature',
                    url: 'https://example.test/windows'
                }
            }
        });
        expect(() => readBaseManifest(basePath, '2.31.5')).toThrow(
            'Base manifest version 2.31.4 does not match 2.31.5.'
        );
    });

    it('writes the updater manifest through the production CLI', () => {
        const directory = createTemporaryDirectory();
        const signaturePath = path.join(directory, 'signature.sig');
        const notesPath = path.join(directory, 'notes.md');
        const outputPath = path.join(directory, 'nested', 'latest.json');
        fs.writeFileSync(signaturePath, ' signed-value \n');
        fs.writeFileSync(notesPath, ' Release notes \n');

        const result = spawnSync(
            process.execPath,
            [
                path.join(
                    import.meta.dirname,
                    'create-tauri-updater-manifest.ts'
                ),
                '--version',
                '2.31.4',
                '--tag',
                'v2.31.4',
                '--target',
                'linux-x86_64-appimage-stable',
                '--asset-name',
                'VRCX-0.AppImage',
                '--signature-file',
                signaturePath,
                '--notes-file',
                notesPath,
                '--out',
                outputPath
            ],
            { encoding: 'utf8', env: releaseScriptEnvironment() }
        );

        expect(result.status).toBe(0);
        expect(result.stderr).toBe('');
        expect(result.stdout.trim()).toBe(outputPath);
        expect(JSON.parse(fs.readFileSync(outputPath, 'utf8'))).toMatchObject({
            version: '2.31.4',
            notes: 'Release notes',
            platforms: {
                'linux-x86_64-appimage-stable': {
                    signature: 'signed-value',
                    url: 'https://github.com/Map1en/VRCX-0/releases/download/v2.31.4/VRCX-0.AppImage'
                }
            }
        });
    });
});

describe('generate-third-party-licenses', () => {
    it('normalizes untrusted frontend license entries', () => {
        expect(
            normalizeFrontendEntry(
                {
                    name: ' Example Package ',
                    version: ' 1.2.3 ',
                    identifier: ' MIT ',
                    text: ' Copyright\r\nExample '
                },
                0
            )
        ).toEqual({
            id: 'frontend-example-package-1-2-3',
            name: 'Example Package',
            version: '1.2.3',
            license: 'MIT',
            sourceType: 'frontend',
            sourceLabel: 'Frontend bundle',
            noticeText: 'Copyright\nExample',
            needsReview: false
        });
        expect(sanitizeId(' @Scope/Package 1.0 ')).toBe('scope-package-1-0');
    });

    it('groups notice entries without dropping missing license text', () => {
        const notice = createThirdPartyNoticeText([
            normalizeFrontendEntry({ name: 'Alpha', version: '1.0.0' }, 0),
            normalizeFrontendEntry(
                {
                    name: 'Beta',
                    version: '2.0.0',
                    license: 'MIT',
                    noticeText: 'Beta notice'
                },
                1
            )
        ]);

        expect(notice).toContain('Frontend bundle');
        expect(notice).toContain('## Alpha - 1.0.0');
        expect(notice).toContain(
            'No local license text was generated for this entry.'
        );
        expect(notice).toContain('## Beta - 2.0.0 (MIT)');
        expect(notice).toContain('Beta notice');
        expect(notice.endsWith('\n')).toBe(true);
    });

    it('parses cargo metadata through an explicit boundary', () => {
        expect(
            parseCargoMetadata({
                workspace_members: ['workspace 0.1.0'],
                packages: [
                    {
                        id: 'dependency 1.0.0',
                        name: 'dependency',
                        version: '1.0.0',
                        license: 'MIT',
                        license_file: null,
                        repository: 'https://example.test/dependency',
                        homepage: null
                    }
                ]
            })
        ).toEqual({
            workspaceMembers: ['workspace 0.1.0'],
            packages: [
                {
                    id: 'dependency 1.0.0',
                    name: 'dependency',
                    version: '1.0.0',
                    license: 'MIT',
                    licenseFile: '',
                    repository: 'https://example.test/dependency',
                    homepage: ''
                }
            ]
        });
    });
});
