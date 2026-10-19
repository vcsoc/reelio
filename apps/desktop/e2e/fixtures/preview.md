# Preview Fixture

`preview.webm` is a generated, silent 64x36 VP9 test video (120 seconds at one frame per second). It contains only a solid color; no third-party media is included.

Regenerate from the repository root with:

```sh
ffmpeg -hide_banner -loglevel error -f lavfi -i 'color=c=0x1b293d:s=64x36:r=1:d=120' -an -c:v libvpx-vp9 -b:v 10k -y apps/desktop/e2e/fixtures/preview.webm
```

The mocked-IPC UI tests use this real, small media payload to exercise browser decoding and the persistent seek controls. This does not qualify native export dialogs, audible mixing, or every platform's WebView gestures.
