# Pull request draft

## Title

`feat: add English localization support`

## Summary

- Add English and Simplified Chinese interface switching with a persisted locale preference and English fallback.
- Add a centralized English catalog with interpolation and dynamic-message support.
- Protect project-authored and AI-generated content from automatic translation.
- Localize Markdown, screenplay, AI-package, filename, and package-error outputs without changing compatibility JSON.
- Add deterministic localization audits, runtime ZIP validation, contributor documentation, and an English-first README.

## Compatibility

Existing Chinese projects remain compatible. JSON keys, schema keys, and Chinese semantic enum values are unchanged. Public export APIs retain Chinese defaults when no locale is supplied.

## Validation

- `npm test`
- `npm run audit:i18n`
- `npm run lint`
- `npm run build`

Record the exact passing test count and build output before submitting the pull request.

## Review focus

1. English terminology and catalog quality.
2. Dynamic-content protection boundaries.
3. Generated-output compatibility and schema preservation.
4. Locale persistence and browser fallback behavior.
5. Runtime ZIP export validation.

## Known design choice

The implementation keeps Chinese source strings as the canonical compatibility layer. This minimizes migration risk but means new UI copy must be added to the English catalog as part of normal development.
