import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

type JsonRecord = Record<string, unknown>;

type ThirdPartyLicenseEntry = {
    id: string;
    name: string;
    version: string;
    license: string;
    sourceType: string;
    sourceLabel: string;
    projectUrl?: string;
    noticeTexts: string[];
    needsReview: boolean;
};

type CargoMetadataPackage = {
    id: string;
    name: string;
    version: string;
    license: string;
    licenseFile: string;
    repository: string;
    homepage: string;
    manifestPath: string;
};

type CargoMetadata = {
    workspaceMembers: string[];
    packages: CargoMetadataPackage[];
};

const rootDir = path.join(import.meta.dirname, '..');
const outputDir = path.join(rootDir, 'dist', 'licenses');
const frontendLicenseJsonPath = path.join(outputDir, 'frontend-licenses.json');
const outputManifestPath = path.join(outputDir, 'third-party-licenses.json');
const packageLockPath = path.join(rootDir, 'package-lock.json');
const tauriLicenseResourceDir = path.join(
    rootDir,
    'src-tauri',
    'resources',
    'licenses'
);
const tauriResourceNoticePath = path.join(
    tauriLicenseResourceDir,
    'THIRD_PARTY_NOTICES.txt'
);
const bundledFontPackages = Object.freeze(['@fontsource-variable/geist']);
const crateLicenseFilePattern = /^(licen[cs]e|copying|notice|unlicense)/i;
const defaultLoggerTarget = 'x86_64-unknown-linux-musl';
const vendoredLicenseDir = path.join(
    rootDir,
    'scripts',
    'third-party-license-texts'
);
const missingLicenseText =
    'No local license text was generated for this entry.';

function isRecord(value: unknown): value is JsonRecord {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeWhitespace(value: unknown): string {
    return String(value ?? '')
        .replace(/\r\n/g, '\n')
        .trim();
}

function sanitizeId(value: unknown): string {
    return String(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

function readRequiredJsonArray(filePath: string): unknown[] {
    if (!fs.existsSync(filePath)) {
        throw new Error(
            `Missing frontend license manifest: ${path.relative(rootDir, filePath)}`
        );
    }

    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!Array.isArray(parsed)) {
        throw new Error(
            `Frontend license manifest must be a JSON array: ${path.relative(rootDir, filePath)}`
        );
    }

    return parsed;
}

function normalizeFrontendEntry(
    entry: unknown,
    index: number
): ThirdPartyLicenseEntry {
    const source = isRecord(entry) ? entry : {};
    const packageName =
        normalizeWhitespace(source.name) || `frontend-package-${index + 1}`;
    const version = normalizeWhitespace(source.version);
    const license = normalizeWhitespace(source.identifier || source.license);
    const noticeText = normalizeWhitespace(source.text || source.noticeText);

    return {
        id: `frontend-${sanitizeId(`${packageName}-${version || index + 1}`)}`,
        name: packageName,
        version,
        license,
        sourceType: 'frontend',
        sourceLabel: 'Frontend bundle',
        noticeTexts: noticeText ? [noticeText] : [],
        needsReview: !license && !noticeText
    };
}

function getPackageDir(packageName: string): string {
    return path.join(rootDir, 'node_modules', ...packageName.split('/'));
}

function readPackageJson(packageName: string): JsonRecord {
    const packageJsonPath = path.join(
        getPackageDir(packageName),
        'package.json'
    );
    if (!fs.existsSync(packageJsonPath)) {
        return {};
    }

    const parsed: unknown = JSON.parse(
        fs.readFileSync(packageJsonPath, 'utf8')
    );
    return isRecord(parsed) ? parsed : {};
}

function readPackageLicenseText(packageName: string): string {
    const licensePath = path.join(getPackageDir(packageName), 'LICENSE');
    if (!fs.existsSync(licensePath)) {
        return '';
    }

    return normalizeWhitespace(fs.readFileSync(licensePath, 'utf8'));
}

function readBundledFontEntries(
    existingEntries: readonly ThirdPartyLicenseEntry[]
): ThirdPartyLicenseEntry[] {
    if (!fs.existsSync(packageLockPath)) {
        return [];
    }

    const parsedPackageLock: unknown = JSON.parse(
        fs.readFileSync(packageLockPath, 'utf8')
    );
    const packageLock = isRecord(parsedPackageLock) ? parsedPackageLock : {};
    const packages = isRecord(packageLock.packages) ? packageLock.packages : {};
    const existingEntryKeys = new Set(
        existingEntries.map((entry) => `${entry.name}@${entry.version}`)
    );

    return bundledFontPackages
        .map((packageName, index): ThirdPartyLicenseEntry | null => {
            const lockEntryValue = packages[`node_modules/${packageName}`];
            if (!isRecord(lockEntryValue)) {
                return null;
            }

            const packageJson = readPackageJson(packageName);
            const entryName =
                normalizeWhitespace(packageJson.name) || packageName;
            const version = normalizeWhitespace(
                packageJson.version || lockEntryValue.version
            );
            if (existingEntryKeys.has(`${entryName}@${version}`)) {
                return null;
            }

            const license = normalizeWhitespace(
                packageJson.license || lockEntryValue.license
            );
            const noticeText = readPackageLicenseText(packageName);

            return {
                id: `font-${sanitizeId(`${entryName}-${version || index + 1}`)}`,
                name: entryName,
                version,
                license,
                sourceType: 'font',
                sourceLabel: 'Bundled font asset',
                projectUrl: normalizeWhitespace(packageJson.homepage),
                noticeTexts: noticeText ? [noticeText] : [],
                needsReview: !license && !noticeText
            };
        })
        .filter((entry): entry is ThirdPartyLicenseEntry => entry !== null);
}

function entryLabel(entry: ThirdPartyLicenseEntry): string {
    return `${entry.name}${entry.version ? ` ${entry.version}` : ''}${entry.license ? ` (${entry.license})` : ''}`;
}

function createThirdPartyNoticeText(
    entries: readonly ThirdPartyLicenseEntry[],
    title = 'VRCX-0 Third-Party Notices'
): string {
    const lines = [title, '', `Generated: ${new Date().toISOString()}`, ''];

    if (entries.some((entry) => /\bIJG\b/.test(entry.license))) {
        lines.push(
            'This software is based in part on the work of the Independent JPEG Group.',
            ''
        );
    }

    if (!entries.length) {
        lines.push('No license manifest was available.', '');
        return `${lines.join('\n').trimEnd()}\n`;
    }

    const groups = new Map<string, ThirdPartyLicenseEntry[]>();
    for (const entry of entries) {
        const label = entry.sourceLabel || 'Third-party dependency';
        const entriesForLabel = groups.get(label) || [];
        entriesForLabel.push(entry);
        groups.set(label, entriesForLabel);
    }

    const sortedLabels = [...groups.keys()].sort((left, right) =>
        left.localeCompare(right)
    );
    for (const label of sortedLabels) {
        lines.push(
            '========================================',
            label,
            '========================================',
            ''
        );
        const usersByText = new Map<string, string[]>();
        const entriesWithoutText: string[] = [];
        for (const entry of groups.get(label) || []) {
            if (!entry.noticeTexts.length) {
                entriesWithoutText.push(entryLabel(entry));
            }
            for (const text of entry.noticeTexts) {
                const users = usersByText.get(text) || [];
                users.push(entryLabel(entry));
                usersByText.set(text, users);
            }
        }
        for (const [text, users] of usersByText) {
            lines.push(
                '## Used by',
                ...users.map((user) => `- ${user}`),
                '',
                text,
                ''
            );
        }
        for (const user of entriesWithoutText) {
            lines.push(`## ${user}`, '', missingLicenseText, '');
        }
    }

    return `${lines.join('\n').trimEnd()}\n`;
}

function createLicenseManifest(entries: readonly ThirdPartyLicenseEntry[]) {
    const noticeTexts: string[] = [];
    const textIndexes = new Map<string, number>();
    const textIndex = (text: string) => {
        let index = textIndexes.get(text);
        if (index === undefined) {
            index = noticeTexts.length;
            noticeTexts.push(text);
            textIndexes.set(text, index);
        }
        return index;
    };
    return {
        generatedAt: new Date().toISOString(),
        noticePath: 'licenses/THIRD_PARTY_NOTICES.txt',
        noticeTexts,
        entries: entries.map(({ noticeTexts: texts, ...entry }) => ({
            ...entry,
            noticeTextIndexes: texts.map(textIndex)
        }))
    };
}

function parseCargoMetadata(value: unknown): CargoMetadata {
    if (!isRecord(value)) {
        throw new Error('Cargo metadata must be an object');
    }
    const workspaceMembers = Array.isArray(value.workspace_members)
        ? value.workspace_members.map(String)
        : [];
    const packages = Array.isArray(value.packages)
        ? value.packages.filter(isRecord).map((pkg): CargoMetadataPackage => ({
              id: normalizeWhitespace(pkg.id),
              name: normalizeWhitespace(pkg.name),
              version: normalizeWhitespace(pkg.version),
              license: normalizeWhitespace(pkg.license),
              licenseFile: normalizeWhitespace(pkg.license_file),
              repository: normalizeWhitespace(pkg.repository),
              homepage: normalizeWhitespace(pkg.homepage),
              manifestPath: normalizeWhitespace(pkg.manifest_path)
          }))
        : [];
    return { workspaceMembers, packages };
}

function parseCargoTreePackages(output: string): Set<string> {
    const packages = new Set<string>();
    for (const line of output.split('\n')) {
        const match = /^(\S+) v(\S+)/.exec(line.trim());
        if (match) {
            packages.add(`${match[1]} ${match[2]}`);
        }
    }
    return packages;
}

function readCrateLicenseTexts(manifestPath: string): string[] {
    const crateDir = path.dirname(manifestPath);
    if (!manifestPath || !fs.existsSync(crateDir)) {
        return [];
    }
    return fs
        .readdirSync(crateDir, { withFileTypes: true })
        .filter(
            (file) => file.isFile() && crateLicenseFilePattern.test(file.name)
        )
        .map((file) => file.name)
        .sort((left, right) => left.localeCompare(right))
        .map((name) =>
            normalizeWhitespace(
                fs.readFileSync(path.join(crateDir, name), 'utf8')
            )
        )
        .filter(Boolean);
}

function readVendoredLicenseTexts(crateName: string): string[] {
    const licensePath = path.join(vendoredLicenseDir, `${crateName}.txt`);
    if (!fs.existsSync(licensePath)) {
        return [];
    }
    return [normalizeWhitespace(fs.readFileSync(licensePath, 'utf8'))];
}

function readCargoMetadata(filterPlatform?: string): CargoMetadata {
    const args = [
        'metadata',
        '--format-version',
        '1',
        '--manifest-path',
        path.join(rootDir, 'Cargo.toml')
    ];
    if (filterPlatform) {
        args.push('--filter-platform', filterPlatform);
    }
    const output = execFileSync('cargo', args, {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 64
    });
    return parseCargoMetadata(JSON.parse(output));
}

function readRustEntries(): ThirdPartyLicenseEntry[] {
    if (!fs.existsSync(path.join(rootDir, 'Cargo.toml'))) {
        return [];
    }

    let metadata: CargoMetadata;
    try {
        metadata = readCargoMetadata();
    } catch (error) {
        console.warn(
            `Skipping Rust dependency licenses (cargo unavailable): ${error instanceof Error ? error.message : String(error)}`
        );
        return [];
    }

    return rustEntries(metadata);
}

function rustEntries(
    metadata: CargoMetadata,
    includedPackages?: ReadonlySet<string>
): ThirdPartyLicenseEntry[] {
    const workspaceMemberIds = new Set(metadata.workspaceMembers);
    return metadata.packages
        .filter((pkg) => !workspaceMemberIds.has(pkg.id))
        .filter(
            (pkg) =>
                !includedPackages ||
                includedPackages.has(`${pkg.name} ${pkg.version}`)
        )
        .map((pkg): ThirdPartyLicenseEntry => {
            const license = normalizeWhitespace(
                pkg.license || (pkg.licenseFile ? `See ${pkg.licenseFile}` : '')
            );
            const crateTexts = readCrateLicenseTexts(pkg.manifestPath);
            const noticeTexts = crateTexts.length
                ? crateTexts
                : readVendoredLicenseTexts(pkg.name);

            return {
                id: `rust-${sanitizeId(`${pkg.name}-${pkg.version}`)}`,
                name: pkg.name,
                version: pkg.version,
                license,
                sourceType: 'rust',
                sourceLabel: 'Rust dependency (backend)',
                projectUrl: normalizeWhitespace(pkg.repository || pkg.homepage),
                noticeTexts,
                needsReview: !license && !noticeTexts.length
            };
        });
}

function removeIntermediateFrontendManifest(): void {
    if (fs.existsSync(frontendLicenseJsonPath)) {
        fs.unlinkSync(frontendLicenseJsonPath);
    }
}

function readLoggerPackages(target: string): Set<string> {
    const output = execFileSync(
        'cargo',
        [
            'tree',
            '--manifest-path',
            path.join(rootDir, 'Cargo.toml'),
            '-p',
            'vrcx-0-logger',
            '-e',
            'normal',
            '--target',
            target,
            '--prefix',
            'none',
            '--format',
            '{p}'
        ],
        { encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 }
    );
    return parseCargoTreePackages(output);
}

function writeLoggerNotices(outputPath: string, target: string): void {
    const entries = rustEntries(
        readCargoMetadata(target),
        readLoggerPackages(target)
    ).sort((left, right) => left.name.localeCompare(right.name));
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(
        outputPath,
        createThirdPartyNoticeText(
            entries,
            'VRCX-0 Self-hosted Recorder Third-Party Notices'
        )
    );
    console.log(
        `Generated recorder third-party notices with ${entries.length} entries.`
    );
}

function main(): void {
    const loggerFlag = process.argv.indexOf('--logger');
    if (loggerFlag >= 0) {
        const outputPath = process.argv[loggerFlag + 1];
        if (!outputPath) {
            throw new Error('--logger requires an output path');
        }
        const targetFlag = process.argv.indexOf('--target');
        const target =
            targetFlag >= 0
                ? process.argv[targetFlag + 1]
                : defaultLoggerTarget;
        if (!target) {
            throw new Error('--target requires a Rust target triple');
        }
        writeLoggerNotices(path.resolve(outputPath), target);
        return;
    }

    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(tauriLicenseResourceDir, { recursive: true });

    const frontendEntries = readRequiredJsonArray(frontendLicenseJsonPath)
        .map(normalizeFrontendEntry)
        .sort((left, right) => left.name.localeCompare(right.name));
    const bundledFontEntries = readBundledFontEntries(frontendEntries);
    const rustEntries = readRustEntries();
    const entries = [
        ...frontendEntries,
        ...bundledFontEntries,
        ...rustEntries
    ].sort((left, right) => left.name.localeCompare(right.name));
    const manifest = createLicenseManifest(entries);

    fs.writeFileSync(outputManifestPath, JSON.stringify(manifest, null, 4));
    fs.writeFileSync(
        tauriResourceNoticePath,
        createThirdPartyNoticeText(entries)
    );
    removeIntermediateFrontendManifest();

    const reviewCount = manifest.entries.filter(
        (entry) => entry.needsReview
    ).length;
    console.log(
        `Generated third-party license manifest with ${manifest.entries.length} entries (${reviewCount} requiring review).`
    );
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
    main();
}

export {
    createLicenseManifest,
    createThirdPartyNoticeText,
    normalizeFrontendEntry,
    parseCargoMetadata,
    parseCargoTreePackages,
    readCrateLicenseTexts,
    sanitizeId
};
