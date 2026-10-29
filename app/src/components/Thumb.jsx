/*
 * Image with a size-suffixed thumbnail request and a two-step fallback chain:
 *   sized thumbnail -> original image -> solid placeholder block (first letter).
 * Fills a fixed-size container so the card never jitters while the image loads.
 *
 * `picThumb` is the API's word on which thumbnail the CDN actually has. A
 * quarter of titles have none ('') and some only a square 300x300 one, so the
 * sized request is skipped unless picThumb names exactly that size — otherwise
 * it would 404 (or crop a square into the 2:3 frame). Entries saved before the
 * field existed don't carry it and still try the sized form first.
 *
 * The CDN normally fits the poster inside the size box, keeping its aspect
 * ratio (a 2:3 poster comes back 373x560). For some sources (a square logo,
 * say) it stretches the image to fill the box exactly instead. Only a
 * stretched thumbnail — or a source that already happens to be ~0.686 — comes
 * back at exactly the box size, so that is treated as untrustworthy and the
 * original loads instead. The thumbnail stays invisible until it passes, so a
 * stretched frame never flashes up.
 *
 * Loads eagerly: every list here is small or paginated, and in Chromium <= 120
 * (webOS 24/25) loading="lazy" inside a nested scroller only starts the fetch
 * once the image is on screen, so fetch, decode and the onLoad render all land
 * mid-scroll. decoding="async" lets a large original decode off the raster path
 * instead of stalling its tile.
 */
import { useState } from 'react'
import { imageUrl } from '../source/index.js'

export default function Thumb({ pic, picThumb, alt = '', size = '384x560' }) {
  // 0 = sized thumbnail, 1 = original image, 2 = placeholder block
  const [stage, setStage] = useState(() =>
    picThumb === undefined || imageUrl(picThumb) === imageUrl(pic, size) ? 0 : 1,
  )
  const [fitOk, setFitOk] = useState(false) // the sized thumbnail kept its aspect ratio

  if (!pic || stage === 2) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-elev text-display text-fg-3" aria-label={alt}>
        {(alt || '?').slice(0, 1)}
      </div>
    )
  }

  const src = stage === 0 ? imageUrl(pic, size) : imageUrl(pic)
  const [boxW, boxH] = size.split('x').map(Number)
  const checkFit = stage === 0 && boxW > 0 && boxH > 0
  return (
    <img
      className={`h-full w-full object-cover ${checkFit && !fitOk ? 'invisible' : ''}`}
      src={src}
      alt={alt}
      decoding="async"
      onLoad={(e) => {
        if (!checkFit) return
        const { naturalWidth: w, naturalHeight: h } = e.currentTarget
        if (w === boxW && h === boxH) setStage(1)
        else setFitOk(true)
      }}
      onError={() => setStage((s) => s + 1)}
    />
  )
}
