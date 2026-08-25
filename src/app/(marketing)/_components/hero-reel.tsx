import Image from "next/image";

/**
 * The wall of frames behind the hero headline.
 *
 * Three columns of pictures at three depths, drifting at three rates as the
 * page is scrolled, inside the stage that stands up from 22 degrees as it
 * arrives. HeroStage drives it; this file only describes what is on the wall.
 *
 * The frames are drawn, not photographed. Putting real paparazzi shots here
 * means licensing photographs of identifiable people for commercial use, which
 * is the exact thing the product exists to keep straight -- so each frame is a
 * generated night scene in public/marketing/hero/: flash bokeh, dragged
 * shutter, sodium glare, something dark and close to the lens. What makes a
 * frame like this legible at this size was never the face, it was the light.
 * Nobody is depicted, and the captions carry the same [Subject] markers as the
 * rest of the site.
 *
 * To put real work in: drop the photograph in public/marketing/hero/ and give
 * the frame a `src` and an `alt`. It renders in the same box the scene was
 * holding, so the composition does not move as pictures arrive one at a time,
 * and a half-photographed wall is not a broken one.
 */
export interface Frame {
  /** Set once a licensed photograph exists. Until then the placeholder shows. */
  readonly src?: string;
  readonly alt?: string;
  /** The generated scene behind the frame, from public/marketing/hero/. */
  readonly scene: string;
  /** Portrait frames break the grid the way a real contact sheet does. */
  readonly tall?: boolean;
  readonly caption: string;
  readonly meta: string;
}

/**
 * Read as a contact sheet: a night's work, the archive it came from, and what
 * each frame turned into. The columns are ordered so the eye finds a caption
 * near the headline rather than behind it.
 */
const COLUMNS: readonly (readonly Frame[])[] = [
  [
    {
      scene: "sunset-tower",
      caption: "[Subject] · Sunset Tower",
      meta: "11:08 PM · exclusive 48h",
      tall: true,
    },
    { scene: "valet", caption: "[Subject] · valet", meta: "Licensed $1,800" },
    { scene: "melrose", caption: "[Subject] · Melrose", meta: "2024 · archive" },
  ],
  [
    { scene: "premiere", caption: "[Franchise] premiere", meta: "2022 · 5 sets on file" },
    { scene: "arrivals", caption: "[Subject] · arrivals", meta: "Daily Mail · opened", tall: true },
    {
      scene: "courthouse",
      caption: "[Subject] · courthouse",
      meta: "Rights match · evidence saved",
    },
  ],
  [
    { scene: "coffee-run", caption: "[Subject] · coffee run", meta: "2019 · repitched" },
    { scene: "airport", caption: "[Subject] · airport", meta: "6 pitches · 2 exclusive" },
    { scene: "after-party", caption: "[Subject] · after-party", meta: "Paid net 30", tall: true },
  ],
];

/** Depth per column: how far back it sits, and so how far it drifts. */
const DEPTHS = [1.35, 0.85, 1.15];

export function HeroReel() {
  return (
    <div className="reel" id="heroReel" aria-hidden="true">
      {COLUMNS.map((frames, column) => (
        <div className="reel-col" data-drift={DEPTHS[column]} key={column}>
          {/* Twice through, so a column can drift a full frame without
              running out of wall. */}
          {[...frames, ...frames].map((frame, index) => (
            <figure
              className={`reel-frame${frame.tall ? " tall" : ""}`}
              key={`${column}-${index}`}
              style={{ backgroundImage: `url(/marketing/hero/${frame.scene}.svg)` }}
            >
              {frame.src ? <Image alt={frame.alt ?? ""} fill sizes="33vw" src={frame.src} /> : null}
              <figcaption>
                <b>{frame.caption}</b>
                <span>{frame.meta}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      ))}
    </div>
  );
}
