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
    createLicenseManifest,
    createThirdPartyNoticeText,
    normalizeFrontendEntry,
    parseCargoMetadata,
    parseCargoTreePackages,
    readCrateLicenseTexts,
    sanitizeId
} from './generate-third-party-licenses';
import {
    buildReleaseMeta,
    syncVersionToManifests
} from './prepare-release-version';

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

describe('recorder third-party notices', () => {
    it('lists each crate the recorder builds once, whatever cargo tree marks it with', () => {
        const packages = parseCargoTreePackages(
            [
                'vrcx-0-logger v2.32.0 (D:\\Code\\VRCX-0\\crates\\logger)',
                'rustls v0.23.1',
                'ring v0.17.8',
                'rustls v0.23.1 (*)',
                'specta-macros v2.0.0-rc.18 (proc-macro)',
                ''
            ].join('\n')
        );

        expect([...packages].sort()).toEqual([
            'ring 0.17.8',
            'rustls 0.23.1',
            'specta-macros 2.0.0-rc.18',
            'vrcx-0-logger 2.32.0'
        ]);
    });

    it('reads every license and notice file shipped in a crate', () => {
        const crateDir = createTemporaryDirectory();
        fs.writeFileSync(path.join(crateDir, 'Cargo.toml'), '[package]\n');
        fs.writeFileSync(path.join(crateDir, 'LICENSE-MIT'), 'MIT text\r\n');
        fs.writeFileSync(path.join(crateDir, 'LICENSE-APACHE'), 'Apache text');
        fs.writeFileSync(path.join(crateDir, 'NOTICE'), 'Notice text');
        fs.writeFileSync(path.join(crateDir, 'README.md'), 'Readme');

        expect(
            readCrateLicenseTexts(path.join(crateDir, 'Cargo.toml'))
        ).toEqual(['Apache text', 'MIT text', 'Notice text']);
    });
});

describe('recorder release version', () => {
    function releaseCheckout() {
        const root = createTemporaryDirectory();
        const manifest = (name: string) =>
            `[package]\nname = "${name}"\nversion = "0.1.0"\n`;
        const lockEntry = (name: string) =>
            `[[package]]\nname = "${name}"\nversion = "0.1.0"\n`;
        const write = (content: string, ...segments: string[]) => {
            fs.mkdirSync(path.join(root, ...segments.slice(0, -1)), {
                recursive: true
            });
            fs.writeFileSync(path.join(root, ...segments), content);
        };
        write(
            JSON.stringify({ version: '2.31.0' }),
            'src-tauri',
            'tauri.conf.json'
        );
        write(manifest('vrcx-0'), 'src-tauri', 'Cargo.toml');
        write(manifest('vrcx-0-logger'), 'crates', 'logger', 'Cargo.toml');
        write(
            manifest('vrcx-0-logger-protocol'),
            'crates',
            'logger-protocol',
            'Cargo.toml'
        );
        write(
            ['vrcx-0-logger-protocol', 'vrcx-0-logger', 'vrcx-0']
                .map(lockEntry)
                .join('\n'),
            'Cargo.lock'
        );
        const read = (...segments: string[]) =>
            fs.readFileSync(path.join(root, ...segments), 'utf8');
        return { root, read, manifest, lockEntry };
    }

    it('moves the recorder to the same version as the desktop release', () => {
        const { root, read } = releaseCheckout();

        syncVersionToManifests('2.32.0-beta.1', root);

        expect(JSON.parse(read('src-tauri', 'tauri.conf.json')).version).toBe(
            '2.32.0-beta.1'
        );
        expect(read('src-tauri', 'Cargo.toml')).toContain(
            'version = "2.32.0-beta.1"'
        );
        expect(read('crates', 'logger', 'Cargo.toml')).toContain(
            'version = "2.32.0-beta.1"'
        );
        expect(read('Cargo.lock')).toContain(
            'name = "vrcx-0-logger"\nversion = "2.32.0-beta.1"'
        );
        expect(read('Cargo.lock')).toContain(
            'name = "vrcx-0"\nversion = "2.32.0-beta.1"'
        );
    });

    it('leaves similarly named crates such as the recorder protocol on their own version', () => {
        const { root, read, manifest, lockEntry } = releaseCheckout();

        syncVersionToManifests('2.32.0-beta.1', root);

        expect(read('crates', 'logger-protocol', 'Cargo.toml')).toBe(
            manifest('vrcx-0-logger-protocol')
        );
        expect(read('Cargo.lock')).toBe(
            [
                lockEntry('vrcx-0-logger-protocol'),
                lockEntry('vrcx-0-logger').replace('0.1.0', '2.32.0-beta.1'),
                lockEntry('vrcx-0').replace('0.1.0', '2.32.0-beta.1')
            ].join('\n')
        );
    });
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
            noticeTexts: ['Copyright\nExample'],
            needsReview: false
        });
        expect(sanitizeId(' @Scope/Package 1.0 ')).toBe('scope-package-1-0');
    });

    it('writes a shared license text once and lists every package that uses it', () => {
        const notice = createThirdPartyNoticeText([
            normalizeFrontendEntry({ name: 'Alpha', version: '1.0.0' }, 0),
            normalizeFrontendEntry(
                {
                    name: 'Beta',
                    version: '2.0.0',
                    license: 'MIT',
                    noticeText: 'Shared notice'
                },
                1
            ),
            normalizeFrontendEntry(
                {
                    name: 'Gamma',
                    version: '3.0.0',
                    license: 'MIT',
                    noticeText: 'Shared notice'
                },
                2
            )
        ]);

        expect(notice).toContain('Frontend bundle');
        expect(notice).toContain(
            '## Used by\n- Beta 2.0.0 (MIT)\n- Gamma 3.0.0 (MIT)\n\nShared notice'
        );
        expect(notice.match(/Shared notice/g)).toHaveLength(1);
        expect(notice).toContain(
            '## Alpha 1.0.0\n\nNo local license text was generated for this entry.'
        );
        expect(notice.endsWith('\n')).toBe(true);
    });

    it('credits the Independent JPEG Group only when an IJG-licensed dependency is bundled', () => {
        const ijgCredit =
            'This software is based in part on the work of the Independent JPEG Group.';
        const mitOnly = createThirdPartyNoticeText([
            normalizeFrontendEntry({ name: 'Beta', license: 'MIT' }, 0)
        ]);
        const withIjg = createThirdPartyNoticeText([
            normalizeFrontendEntry({ name: 'Beta', license: 'MIT' }, 0),
            normalizeFrontendEntry(
                {
                    name: 'jpeg-encoder',
                    license: '(MIT OR Apache-2.0) AND IJG'
                },
                1
            )
        ]);

        expect(mitOnly).not.toContain(ijgCredit);
        expect(withIjg.match(new RegExp(ijgCredit, 'g'))).toHaveLength(1);
    });

    it('stores each license text once in the manifest and points entries at it', () => {
        const manifest = createLicenseManifest([
            normalizeFrontendEntry(
                { name: 'Beta', noticeText: 'Shared notice' },
                0
            ),
            normalizeFrontendEntry(
                { name: 'Gamma', noticeText: 'Shared notice' },
                1
            ),
            normalizeFrontendEntry({ name: 'Alpha' }, 2)
        ]);

        expect(manifest.noticeTexts).toEqual(['Shared notice']);
        expect(
            manifest.entries.map((entry) => entry.noticeTextIndexes)
        ).toEqual([[0], [0], []]);
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
                    homepage: '',
                    manifestPath: ''
                }
            ]
        });
    });
});
