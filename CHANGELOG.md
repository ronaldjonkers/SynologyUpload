# Changelog

All notable changes to Upload Portal are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/) and the project uses [Semantic Versioning](https://semver.org/).

## [1.0.0] – 2026-10-15

First public release.

### Added
- Native Synology DSM 7 package (`.spk`), installable via Package Center (depends on Node.js v20)
- Admin app in the DSM main menu that uses the DSM login (administrators only)
- Upload links per folder: choose any shared folder or subfolder on any volume; files are saved directly in that folder
- Upload-only user accounts with a 24-character password generator (12–64), strength meter and ready-to-send invitations
- Per-link settings: allowed file types, maximum file size, expiry date, active toggle, regenerate URL
- Upload page with drag & drop of files and folders, live progress, speed (MB/s) and time remaining
- Chunked (8 MB), resumable uploads with automatic retry for very large files
- "Grant access" button to give the package write permission on a shared folder
- Activity log, search, free-space overview and public URL setting for reverse-proxy setups
- English interface
- Files are never overwritten (`name (1).ext`); scrypt password hashing; login rate limiting

[1.0.0]: https://github.com/ronaldjonkers/SynologyUpload/releases/tag/v1.0.0
