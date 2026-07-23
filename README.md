# Lapian Notes ? local-first film breakdown workspace

[English](README.md) ? [Simplified Chinese](README.zh-CN.md)

[![Discord](https://img.shields.io/discord/958164961270591508?logo=discord&logoColor=white&label=Discord&color=5865F2)](https://discord.gg/uT6xryBX9w)
[![X](https://img.shields.io/badge/X-%40bkingfilm-000000?logo=x&logoColor=white)](https://x.com/bkingfilm)
[![Latest release](https://img.shields.io/github/v/release/bkingfilm/lapian-notes?label=latest%20release&color=2d6cdf)](https://github.com/bkingfilm/lapian-notes/releases/latest)
[![License](https://img.shields.io/github/license/bkingfilm/lapian-notes?color=green)](LICENSE)

Lapian Notes turns a film into an editable study notebook. It extracts local frames, aligns subtitles, organizes story segments, and prepares structured packages for AI-assisted analysis without requiring an API key.

The interface supports **English** and **Simplified Chinese**. Processing and project storage remain local to the browser unless you explicitly export a package and send it to an external AI service.

![Lapian Notes workspace](docs/screenshot.jpg)

## Features

- Local video import and frame extraction at configurable intervals.
- Subtitle import, alignment, and timeline navigation.
- Segment-based film breakdown with notes, screenplay blocks, and structural roles.
- Story-line swimlanes, structure trees, and audience-emotion curves.
- AI analysis ZIP packages containing frames, subtitles, prompts, and compatibility schemas.
- Import of AI-generated JSON back into the current project.
- Markdown, screenplay text, image, and project ZIP exports.
- English and Simplified Chinese interface switching with a persisted preference.
- Protection for project titles, subtitles, notes, and AI-generated text so localization never rewrites authored content.

## Language selection

Use the language control in the lower-right corner of the application to switch between English and Simplified Chinese.

The selected locale is stored under `lapian-notes.locale`. A saved preference takes priority over the browser language. Unsupported browser locales fall back to English.

Exported Markdown, screenplay text, AI prompts, package README files, filenames, and user-facing package errors follow the selected locale. Project JSON keys, schema keys, and Chinese semantic enum values remain unchanged for backward compatibility.

## Typical workflow

1. Import a film and choose a frame interval.
2. Import or align subtitles.
3. Create and refine story segments while reviewing the timeline.
4. Export an AI analysis package and send it to the AI tool of your choice.
5. Import the returned JSON into Lapian Notes.
6. Review the structure, story lines, audience curve, and generated notes.
7. Export the finished project or human-readable reports.

Free AI services may sample only part of a large package. For long films, verify that the response covers the complete timeline and use segment-level deep-dive packages when necessary.

## Quick start

### Release package

Download the latest release from the repository's Releases page, extract it, and run:

- Windows: `run.bat`
- macOS: `run.command`

The launcher installs missing runtime dependencies when supported by the release package.

### Development

Requirements:

- Node.js 20.19+ or 22.12+
- A Chromium-based browser for the complete local file workflow
- Optional: `ffmpeg` for formats that need transcoding

```bash
npm install
npm run dev
```

Open the local URL printed by Vite, normally `http://localhost:5173`.

## Validation

```bash
npm test
npm run audit:i18n
npm run lint
npm run build
```

`npm run check` executes the complete sequence.

The localization audit verifies catalog integrity, placeholder parity, terminology, scanner-pollution exclusions, required compatibility boundaries, and English-only documentation.

## Data and privacy

- Project metadata is stored in browser `localStorage`.
- Extracted frame images are stored in IndexedDB.
- Exported project ZIP files contain the project data and selected local media artifacts.
- No project is uploaded automatically.
- Sending an exported package to an external AI service is a separate user action governed by that service's terms.

## Localization architecture

Chinese source strings remain the canonical compatibility layer. The English catalog maps those strings at presentation and generated-output boundaries. User-authored content is isolated with explicit protection tokens or `data-i18n-ignore` boundaries.

See [docs/localization.md](docs/localization.md) for architecture, contribution rules, audits, and the release checklist.

## Support

- Community: [Discord](https://discord.gg/uT6xryBX9w)
- Bugs and feature requests: [GitHub Issues](https://github.com/bkingfilm/lapian-notes/issues)
- Updates: [@bkingfilm](https://x.com/bkingfilm)

## License

[MIT](LICENSE)
