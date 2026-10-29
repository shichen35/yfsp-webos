/*
 * Image with a CDN-resized request and a two-step fallback chain:
 *   resized poster -> original image -> solid placeholder block (first letter).
 * Fills a fixed-size container so the card never jitters while the image loads.
 *
 * The image CDN crops to any box on request (imageUrl's ?w=&h=&mode=crop), so
 * the card asks for exactly its own size instead of downscaling the original.
 *
 * Loads eagerly: every list here is small or paginated, and in Chromium <= 120
 * (webOS 24/25) loading="lazy" inside a nested scroller only starts the fetch
 * once the image is on screen, so fetch, decode and the onLoad render all land
 * mid-scroll. decoding="async" lets a large original decode off the raster path
 * instead of stalling its tile.
 */
import { useState } from 'react'
import { imageUrl } from '../source/index.js'

export default function Thumb({ pic, alt = '', size = '384x560' }) {
  // 0 = resized poster, 1 = original image, 2 = placeholder block
  const [stage, setStage] = useState(0)

  if (!pic || stage === 2) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-elev text-display text-fg-3" aria-label={alt}>
        {(alt || '?').slice(0, 1)}
      </div>
    )
  }

  return (
    <img
      className="h-full w-full object-cover"
      src={stage === 0 ? imageUrl(pic, size) : imageUrl(pic)}
      alt={alt}
      decoding="async"
      onError={() => setStage((s) => s + 1)}
    />
  )
}
