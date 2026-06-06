// @ts-nocheck
/* global __dirname, require */

const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
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
const bundledFontPackages = Object.freeze([
    '@fontsource-variable/geist',
    '@fontsource-variable/noto-sans-sc'
]);

function normalizeWhitespace(value) {
    return String(value ?? '')
        .replace(/\r\n/g, '\n')
        .trim();
}

function sanitizeId(value) {
    return String(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

function readRequiredJsonArray(filePath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(
            `Missing frontend license manifest: ${path.relative(rootDir, filePath)}`
        );
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!Array.isArray(parsed)) {
        throw new Error(
            `Frontend license manifest must be a JSON array: ${path.relative(rootDir, filePath)}`
        );
    }

    return parsed;
}

function normalizeFrontendEntry(entry, index) {
    const packageName =
        normalizeWhitespace(entry?.name) || `frontend-package-${index + 1}`;
    const version = normalizeWhitespace(entry?.version);
    const license = normalizeWhitespace(entry?.identifier || entry?.license);
    const noticeText = normalizeWhitespace(entry?.text || entry?.noticeText);

    return {
        id: `frontend-${sanitizeId(`${packageName}-${version || index + 1}`)}`,
        name: packageName,
        version,
        license,
        sourceType: 'frontend',
        sourceLabel: 'Frontend bundle',
        noticeText,
        needsReview: !license && !noticeText
    };
}

function getPackageDir(packageName) {
    return path.join(rootDir, 'node_modules', ...packageName.split('/'));
}

function readPackageJson(packageName) {
    const packageJsonPath = path.join(
        getPackageDir(packageName),
        'package.json'
    );
    if (!fs.existsSync(packageJsonPath)) {
        return {};
    }

    return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
}

function readPackageLicenseText(packageName) {
    const licensePath = path.join(getPackageDir(packageName), 'LICENSE');
    if (!fs.existsSync(licensePath)) {
        return '';
    }

    return normalizeWhitespace(fs.readFileSync(licensePath, 'utf8'));
}

function readBundledFontEntries(existingEntries) {
    if (!fs.existsSync(packageLockPath)) {
        return [];
    }

    const packageLock = JSON.parse(fs.readFileSync(packageLockPath, 'utf8'));
    const packages = packageLock?.packages || {};
    const existingEntryKeys = new Set(
        existingEntries.map((entry) => `${entry.name}@${entry.version}`)
    );

    return bundledFontPackages
        .map((packageName, index) => {
            const lockEntry = packages[`node_modules/${packageName}`];
            if (!lockEntry) {
                return null;
            }

            const packageJson = readPackageJson(packageName);
            const entryName =
                normalizeWhitespace(packageJson.name) || packageName;
            const version = normalizeWhitespace(
                packageJson.version || lockEntry.version
            );
            if (existingEntryKeys.has(`${entryName}@${version}`)) {
                return null;
            }

            const license = normalizeWhitespace(
                packageJson.license || lockEntry.license
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
                noticeText,
                needsReview: !license && !noticeText
            };
        })
        .filter(Boolean);
}

function createThirdPartyNoticeText(entries) {
    const lines = [
        'VRCX-0 Third-Party Notices',
        '',
        `Generated: ${new Date().toISOString()}`,
        '',
        '========================================',
        'Frontend bundled dependencies',
        '========================================',
        ''
    ];

    if (!entries.length) {
        lines.push('No frontend license manifest was available.', '');
        return `${lines.join('\n').trimEnd()}\n`;
    }

    for (const entry of entries) {
        lines.push(
            `## ${entry.name}${entry.version ? ` - ${entry.version}` : ''}${entry.license ? ` (${entry.license})` : ''}`,
            '',
            entry.noticeText ||
                'No local license text was generated for this entry.',
            ''
        );
    }

    return `${lines.join('\n').trimEnd()}\n`;
}

function removeIntermediateFrontendManifest() {
    if (fs.existsSync(frontendLicenseJsonPath)) {
        fs.unlinkSync(frontendLicenseJsonPath);
    }
}

function main() {
    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(tauriLicenseResourceDir, { recursive: true });

    const frontendEntries = readRequiredJsonArray(frontendLicenseJsonPath)
        .map(normalizeFrontendEntry)
        .sort((left, right) => left.name.localeCompare(right.name));
    const bundledFontEntries = readBundledFontEntries(frontendEntries);
    const entries = [...frontendEntries, ...bundledFontEntries].sort(
        (left, right) => left.name.localeCompare(right.name)
    );
    const manifest = {
        generatedAt: new Date().toISOString(),
        noticePath: 'licenses/THIRD_PARTY_NOTICES.txt',
        entries
    };

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

main();
