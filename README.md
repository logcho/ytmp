# YouTube Converter

A personal desktop app for converting YouTube links to MP3 audio or MP4 video. Built with a native macOS window, a Node.js backend, yt-dlp, and FFmpeg. No API keys are needed.

## macOS app

Download the Apple silicon app ZIP from [Releases](https://github.com/logcho/ytmp/releases), unzip it, and move the app into your Applications folder. Install the required local tools with `brew install python@3.13 ffmpeg` if they are not already present.

Open **YouTube Converter.app** in your personal Applications folder. You can drag it to the Dock for quick access. It opens its own window, starts a private local server on an available port, and stops that server and active conversions when you quit. Downloads use the standard macOS Save dialog.

To rebuild after changing the code:

```sh
npm run desktop:build
```

The result is `dist/YouTube Converter.app`. The bundle contains the interface, Node.js runtime, and yt-dlp Python packages, and can be moved independently of this repository. This personal build uses the Python 3.13 and FFmpeg already installed through Homebrew on this Mac. Keep those installed. It is locally signed, not notarized for distribution to other Macs.

Temporary conversions and the diagnostic `server.log` live in `~/Library/Application Support/YouTube Converter/`. The app requires macOS 13 or newer, and is built for this Mac's architecture. The native window and download handling use [Apple WebKit](https://developer.apple.com/documentation/webkit/wkdownloaddelegate).

## Run

Requires Node.js 20+, Python 3.10+ (3.13 recommended), and FFmpeg on your PATH.

```sh
python3.13 -m venv .venv
.venv/bin/pip install 'yt-dlp[default]'
# macOS, if FFmpeg is missing:
brew install ffmpeg
npm start
```

Open http://localhost:3000. Paste a public YouTube link, select MP3 (128/192/320 kbps) or MP4 (up to 360p/720p/1080p), convert, then download. Output quality is limited by the source. MP4 prefers H.264 video with AAC audio for compatibility.

`PORT` changes the port. `YT_DLP_PATH` can point to a different yt-dlp executable. Update the downloader periodically with `.venv/bin/pip install -U 'yt-dlp[default]'` as YouTube changes.

## Behavior

- Supports normal YouTube videos, Shorts, youtu.be links, and completed live recordings.
- Two conversions at a time, videos under two hours, and a 500 MB per-source-file download limit. Merged files can be larger.
- Files are stored in ignored `.downloads/` directories and expire about one hour after completion. Restarting the server clears the in-memory job index.
- The server binds to loopback only. This is a personal local app. Internet hosting needs authentication, rate limiting, persistent job processing, and storage; Sites/Cloudflare Workers cannot run the required native downloader/FFmpeg processes.
- Restricted videos or YouTube bot checks may prevent conversion. The app reports actual failures and does not bypass access restrictions.
- Only download content you own or have permission to download.

## Verification

```sh
npm test
```

Tests cover link normalization, URL allowlisting, supported conversion settings, static file boundaries, job lookup, and request origin protection. Actual conversion additionally depends on YouTube availability and network access. Downloader options follow the [official yt-dlp documentation](https://github.com/yt-dlp/yt-dlp#readme).
