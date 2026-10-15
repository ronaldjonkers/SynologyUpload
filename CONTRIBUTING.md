# Contributing to Upload Portal

Thanks for wanting to help! Bug reports, ideas, translations and pull requests are all welcome.

## Reporting bugs

[Open an issue](https://github.com/ronaldjonkers/SynologyUpload/issues/new/choose) and include:

- your DSM version and NAS model
- the Upload Portal version (Package Center)
- what you expected and what happened
- relevant lines from `/var/packages/UploadPortal/var/server.log`

## Development

```bash
npm install
npm start          # upload server on http://localhost:8090, using ./dev-shares as fake shared folders
npm run check      # syntax check of all scripts
npm run build      # build dist/UploadPortal-<version>.spk
```

Project layout:

| Path | What |
|---|---|
| `server.js` | Upload server (Express): upload pages, chunked uploads, admin API |
| `cgi.js` | CGI bridge between the DSM admin app and the server (DSM session check) |
| `public/` | Upload page (HTML/CSS/JS) and shared styles |
| `synology/ui/` | DSM admin app (`index.html`, `web/admin.js`, `config`, `api.cgi`) |
| `synology/scripts/`, `synology/conf/`, `synology/INFO.in` | Package metadata and lifecycle scripts |
| `docs/` | User guides and GitHub Pages site |

Important rule: **never place `style.css` or other loose CSS/JS files directly in `synology/ui/`**. DSM loads those into the entire desktop. Keep admin assets in `synology/ui/web/`; `build.sh` enforces this.

## Translations

The interface is in English. Translations to other languages are very welcome: open an issue first so we can agree on the approach (e.g. a small i18n layer).

## Pull requests

- Keep changes focused and describe what you tested (ideally on a real NAS).
- Run `npm run check` and `npm run build` before submitting.
- Update `CHANGELOG.md` under an *Unreleased* heading.

## Releasing (maintainers)

1. Bump `version` in `package.json` and update `CHANGELOG.md`.
2. Commit, then tag: `git tag v1.2.3 && git push --tags`.
3. GitHub Actions builds the `.spk` and publishes the release automatically.
