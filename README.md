# Frame Runner Desktop

Frame Runner is a Windows desktop app for turning an ordered ZIP of images into an MP4.

## End-user workflow

1. Install `Frame-Runner-Setup-1.0.0-x64.exe`.
2. Launch **Frame Runner** from the desktop or Start menu.
3. Choose a ZIP containing PNG, JPG, JPEG, or WebP images.
4. Pick FPS, resolution, and contain/cover behavior.
5. Preview the sequence.
6. Click **Render & Save MP4** and choose the output path.

Nothing is uploaded. ZIP extraction and MP4 encoding happen locally.

## Rendering architecture

The preview uses `@remotion/player`. Final MP4 encoding uses `@remotion/web-renderer`, so the installed desktop app does not require Node.js, npm, FFmpeg, Chrome, or a separate rendering server on the user's machine.

Images are natural-sorted by the names stored in the ZIP. One source image occupies exactly one output frame.

## Build

The GitHub Actions workflow at `.github/workflows/build-windows.yml` builds the x64 NSIS installer on a Windows runner.
