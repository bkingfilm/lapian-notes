# Localization architecture and contribution guide

## Design goals

Lapian Notes must present an English interface without breaking existing Chinese projects, imported AI results, or saved semantic values. The implementation therefore localizes presentation and generated prose instead of rewriting the underlying data model.

## Runtime model

- Supported locales: `en` and `zh-CN`.
- Preference key: `lapian-notes.locale`.
- Resolution order: saved preference, browser locale, English fallback.
- The language switcher is always visible and persists the selection.
- Alerts, confirmations, prompts, text nodes, and selected attributes are localized through the shared catalog.

## Compatibility boundary

The following remain unchanged across locales:

- Project JSON property names.
- AI import/export schema property names.
- Chinese semantic enum values used by existing projects.
- Project titles, film titles, subtitles, notes, screenplay text, and AI-generated content.
- IDs, timestamps, paths, and source filenames.

Generated Markdown, screenplay reports, package instructions, README files, filenames, and user-facing errors may follow the selected locale.

## Protecting authored content

Rendered dynamic content uses narrow `data-i18n-ignore` boundaries. Do not place the attribute on a large container when that would also suppress static interface labels.

Generated artifacts use `createGeneratedTextLocalizer`. Dynamic authored values are replaced with opaque tokens before generated labels are translated, then restored byte-for-byte. Never translate a complete generated document by blind substring replacement.

## Adding interface text

1. Keep the canonical Chinese source string stable when it is part of persisted compatibility behavior.
2. Add or review the English value in `src/i18n/catalog.en.ts`.
3. Preserve every `${placeholder}` in the translated value.
4. Use film-breakdown terminology: *film*, *segment*, *frame extraction*, *story line*, and *Lapian Notes*.
5. Add `data-i18n-ignore` only around dynamic authored or model-generated text.
6. Add a focused test for new interpolation, content-protection, or export behavior.
7. Run the full validation sequence.

## Adding generated output

Public export functions accept an optional locale and default to `zh-CN` for backward compatibility. Build the source document from a protected project copy, localize generated prose, and leave JSON/schema compatibility data untouched.

Runtime tests should inspect the produced output, not only source signatures. The ZIP export test opens the generated archive in memory and verifies English prose plus unchanged authored and schema data.

## Audit policy

`npm run audit:i18n` checks:

- Catalog size and duplicate keys.
- Replacement characters and untranslated markers.
- Disallowed machine-translation terminology.
- Scanner-generated source fragments.
- Balanced and matching placeholders.
- Han characters outside placeholder expressions in English values.
- Critical translations and compatibility safeguards.
- English documentation for accidental Chinese text.

Chinese source strings are intentional canonical data and are not treated as an error by themselves. The audit focuses on English outputs, catalog integrity, and explicit protection boundaries.

## Validation commands

```bash
npm test
npm run audit:i18n
npm run lint
npm run build
```

Use `npm run check` before opening a pull request.

## Release checklist

- [ ] English and Simplified Chinese switch correctly.
- [ ] The locale survives a page reload.
- [ ] An unsupported browser locale starts in English.
- [ ] Existing Chinese project ZIP files import without migration.
- [ ] English Markdown and screenplay exports preserve authored text.
- [ ] English AI packages contain English instructions and unchanged schema keys/enums.
- [ ] Project titles, subtitles, notes, and AI results are not translated.
- [ ] Catalog audit passes with no placeholder or terminology defects.
- [ ] Tests, lint, and production build pass.
- [ ] The pull request documents known compatibility choices and residual risks.

## Risk matrix

| Risk | Control |
|---|---|
| Saved projects become incompatible | Persisted keys and semantic enum values remain unchanged. |
| Authored text is translated | Narrow DOM ignore boundaries and generated-output protection tokens. |
| Dynamic messages lose values | Placeholder-parity audit and interpolation tests. |
| Machine translation introduces domain errors | Terminology audit and curated critical translations. |
| English exports mutate JSON | Runtime ZIP test and explicit schema/project JSON assertions. |
| New Chinese UI strings lack English coverage | Catalog review plus required localization audit in the contribution workflow. |
