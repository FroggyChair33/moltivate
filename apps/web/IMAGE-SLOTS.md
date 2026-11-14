# Moltivate image slots

The page numbers photo locations so a future request can refer to “slot 1” or “slot 2.” Edit `index.html` and source assets here, then rebuild `dist/` with `npm run build`.

| Slot | Location | Current content | Suggested replacement |
| --- | --- | --- | --- |
| **1** | Challenges section; `figure[data-image-slot="1"]` | `assets/photos/gym-crew-frederick-shaw.jpg`, a credited illustrative Unsplash photo | Your crew after a workout; landscape framing, ideally at least 1,200 px wide |
| **2** | Our story section; `figure[data-image-slot="2"]` | Explicit “insert img here — 2” placeholder | Your first Moltivate brainstorm, hackathon table, or day-one team photo |

## Replacing a slot

1. Put the supplied image in `assets/photos/` using a clear filename. Keep the `data-image-slot` number and the existing Polaroid figure so later requests still identify the same location.
2. For slot 1, update the existing image's `src`, `alt`, `width`, and `height` to describe the replacement. For slot 2, replace only the `.image-placeholder` contents with an image and give it an appropriate responsive size within the frame; retain the figure and caption.
3. Update the visible caption and credit to match the actual image. Do not keep Frederick Shaw's credit on someone else's photo or describe stock subjects as Moltivate customers or founders.
4. Record the image's source and permission in `assets/photos/ASSET-SOURCES.md`, then check desktop and phone layouts after rebuilding.

The current slot 1 photograph is free under the [Unsplash License](https://unsplash.com/license). Its original source and photographer are listed in [ASSET-SOURCES.md](assets/photos/ASSET-SOURCES.md). Slot 2 has no photo yet.
