"use client"

import Image from 'next/image'
import { useState } from 'react'
import { Swiper, SwiperSlide } from 'swiper/react'
import { Autoplay, Pagination } from 'swiper/modules'

import 'swiper/css'
import 'swiper/css/pagination'

// ── The house banner set ──────────────────────────────────────────────────────
// Twelve designed banners in public/banners, shown in the order their filenames
// spell out. The filenames are the source of truth for sequence, so the array is
// written out literally rather than generated: the set isn't uniformly spelled
// ("five" not "fifth", "eigth" not "eighth", "twelveth" not "twelfth"), and a
// clever ordinal-generating loop would silently 404 on three of them.
//
// This REPLACES what used to render here — the three CSS house promos, which
// now open in their own centred overlay after the intro (see PromoPosters), and
// the scraped supplier banners from DataContext. Consequences worth knowing:
//   - The hero no longer reads `banners` from DataContext at all, so approving
//     a banner in Admin → Upcoming Products no longer changes this section.
//     The queue and its API are untouched; nothing renders its output.
//   - Nothing here is a link any more. The scraped banners carried supplier URLs
//     that had to be resolved back to our own product/category pages; these are
//     ours, and none of them were given a destination.
//
// All twelve are ~1600×660, which is why the frame below is 1600/660 rather than
// the old 1300/560 — at the old ratio `object-cover` shaved the edges off
// artwork that has text and logos sitting in them.
const BANNERS = [
  { file: 'first', alt: 'Worldwide shipping — container ship and port terminal' },
  { file: 'second', alt: 'ACEFAST speakers, headphones, earbuds and power banks' },
  { file: 'third', alt: 'Our full range — chargers, cables, audio, smartwatches, phones and toys' },
  { file: 'fourth', alt: 'Cygnett chargers, cables, power banks and wireless charging' },
  { file: 'five', alt: 'Portable desk, clip and neck fans' },
  { file: 'sixth', alt: 'Laptop shoulder bag and backpack' },
  { file: 'seventh', alt: 'Intenso microSD memory cards from 16GB to 512GB' },
  { file: 'eigth', alt: 'Philips radios, CD players, micro hi-fi systems and turntable' },
  { file: 'ninth', alt: 'IMILAB 3K home security cameras' },
  { file: 'tenth', alt: 'Electric scooter' },
  { file: 'eleventh', alt: 'Intenso headphones, earbuds, charging cables and batteries' },
  { file: 'twelveth', alt: 'AA and AAA battery multipacks, 8+2 free' },
]

const HeroSlider = () => {
  const [swiper, setSwiper] = useState(null)

  return (
    <section className="container-main">
      <div className="relative w-full max-w-325 mx-auto">
        <Swiper
          modules={[Autoplay, Pagination]}
          autoplay={{ delay: 5000, disableOnInteraction: false }}
          pagination={{ clickable: true }}
          loop
          onSwiper={setSwiper}
          className="hero-swiper rounded-lg overflow-hidden"
        >
          {BANNERS.map((banner, index) => (
            <SwiperSlide key={banner.file}>
              <div className="relative w-full aspect-1600/660 mt-4">
                <Image
                  src={`/banners/${banner.file}.jpeg`}
                  alt={banner.alt}
                  fill
                  // Only the first slide is on screen at load; the rest are
                  // below the fold of the slider and can wait.
                  priority={index === 0}
                  sizes="(max-width: 1024px) 100vw, 1300px"
                  className="object-cover"
                />
              </div>
            </SwiperSlide>
          ))}
        </Swiper>

        {/* Invisible tap zones over the left/right edges — same interaction as
            WhatsApp status: tap left to go back, tap right to go forward. */}
        <button
          type="button"
          onClick={() => swiper?.slidePrev()}
          aria-label="Previous slide"
          className="absolute left-0 top-0 z-10 h-full w-[15%] cursor-pointer bg-transparent border-0 outline-none"
        />
        <button
          type="button"
          onClick={() => swiper?.slideNext()}
          aria-label="Next slide"
          className="absolute right-0 top-0 z-10 h-full w-[15%] cursor-pointer bg-transparent border-0 outline-none"
        />
      </div>
    </section>
  )
}

export default HeroSlider
