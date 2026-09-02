# Frame Runner Desktop

Frame Runner is a Windows desktop app for turning an ordered ZIP of images into an MP4, with an optional soundtrack.

## End-user workflow

1. Install `Frame-Runner-Setup-1.1.0-x64.exe`.
2. Launch **Frame Runner** from the desktop or Start menu.
3. Choose a ZIP containing PNG, JPG, JPEG, or WebP images.
4. Optionally choose an MP3, WAV, M4A, AAC, OGG, or FLAC soundtrack.
5. Pick FPS, resolution, contain/cover behavior, audio volume, and whether short audio should loop.
6. Preview the image sequence and soundtrack together.
7. Click **Render & Save MP4** and choose the output path.

Nothing is uploaded. ZIP extraction, audio handling, and MP4 encoding happen locally.

## Audio behavior

Audio starts at the beginning of the video. If it is longer than the composition, it is cut at the video end. If it is shorter, it ends naturally unless **Loop soundtrack** is enabled. The final MP4 uses AAC audio.

## Rendering architecture

The preview uses `@remotion/player`. Media playback uses `@remotion/media`. Final MP4 encoding uses `@remotion/web-renderer`, so the installed desktop app does not require Node.js, npm, FFmpeg, Chrome, or a separate rendering server on the user's machine.

Images are natural-sorted by the names stored in the ZIP. One source image occupies exactly one output frame.

## Build

The GitHub Actions workflow at `.github/workflows/build-windows.yml` audits production dependencies and builds the x64 NSIS installer on a Windows runner.
