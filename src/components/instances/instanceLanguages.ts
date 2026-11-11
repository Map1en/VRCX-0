import { isRecord } from '@/shared/utils/record';

export type InstanceLanguageRow = {
    code: string;
    iso639: string;
    label: string;
    percent: number;
    declared: boolean;
};

export type InstanceLanguageBadge = {
    code: string;
    tooltip: string;
};

export type InstanceLanguageTooltipLabels = {
    declared: (languages: string) => string;
    current: (languages: string) => string;
};

function stringList(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter(
              (item): item is string =>
                  typeof item === 'string' && Boolean(item.trim())
          )
        : [];
}

function baseCode(code: string) {
    return (code.split('-')[0] ?? code).toLowerCase();
}

function sameCode(left: string, right: string) {
    return left.toLowerCase() === right.toLowerCase();
}

export function instanceLanguageRowText(row: InstanceLanguageRow) {
    return row.percent ? `${row.label} ${row.percent}%` : row.label;
}

export function instanceLanguageRows(
    instance: unknown,
    nameForKey: (key: string) => string | undefined
): InstanceLanguageRow[] {
    const source = isRecord(instance) ? instance : {};
    const ratio = isRecord(source.languageRatio) ? source.languageRatio : {};
    const percentOf = (code: string) => {
        const key = Object.keys(ratio).find((entry) => sameCode(entry, code));
        return key ? Math.round((Number(ratio[key]) || 0) * 100) : 0;
    };
    const created = stringList(source.creationLanguages);
    const listed = stringList(source.languages);
    const observed = Object.keys(ratio).filter((code) => percentOf(code) > 0);
    const languages = created.length
        ? [
              ...created,
              ...observed.filter(
                  (code) => !created.some((entry) => sameCode(entry, code))
              )
          ]
        : listed.length
          ? listed
          : observed;
    if (!languages.length) {
        return [];
    }
    const iso639 = stringList(source.languagesIso639);
    const bases = [...new Set(listed.map(baseCode))];
    const isoByBase = new Map(
        bases.map((base, index) => [base, iso639[index] ?? ''])
    );
    return languages
        .map((code) => {
            const region = code.split('-')[1];
            const iso = isoByBase.get(baseCode(code)) ?? '';
            const name = (iso && nameForKey(iso)) || code;
            return {
                code,
                iso639: iso,
                label: region ? `${name} (${region.toUpperCase()})` : name,
                percent: percentOf(code),
                declared: created.some((entry) => sameCode(entry, code))
            };
        })
        .sort(
            (left, right) =>
                Number(right.declared) - Number(left.declared) ||
                (left.declared ? 0 : right.percent - left.percent)
        );
}

export function instanceLanguageBadges(
    rows: InstanceLanguageRow[],
    labels: InstanceLanguageTooltipLabels
): InstanceLanguageBadge[] {
    const declared = rows.filter((row) => row.declared);
    const badgeRows = declared.length ? declared : rows;
    const byIso = new Map<string, InstanceLanguageRow[]>();
    for (const row of badgeRows) {
        if (row.iso639) {
            byIso.set(row.iso639, [...(byIso.get(row.iso639) ?? []), row]);
        }
    }
    if (!declared.length) {
        return [...byIso.entries()].map(([iso, isoRows]) => ({
            code: iso.toUpperCase(),
            tooltip: isoRows.map(instanceLanguageRowText).join(' · ')
        }));
    }
    const current = rows
        .filter((row) => row.percent > 0)
        .sort((left, right) => right.percent - left.percent)
        .map(instanceLanguageRowText)
        .join(' · ');
    const tooltip = [
        labels.declared(declared.map((row) => row.label).join(' · ')),
        current ? labels.current(current) : ''
    ]
        .filter(Boolean)
        .join('\n');
    return [...byIso.keys()].map((iso) => ({
        code: iso.toUpperCase(),
        tooltip
    }));
}
