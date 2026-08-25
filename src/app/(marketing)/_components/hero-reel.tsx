import Image from "next/image";

/**
 * The wall of frames behind the hero headline.
 *
 * Three columns of pictures at three depths, drifting at three rates as the
 * page is scrolled, inside the stage that stands up from 22 degrees as it
 * arrives. HeroStage drives it; this file only describes what is on the wall.
 *
 * THE PICTURES ARE NOT HERE YET, and that is deliberate rather than pending.
 * Putting real paparazzi shots on this page means licensing photographs of
 * identifiable people for commercial use, which is the exact thing the product
 * exists to keep straight -- so the frames ship as the same kind of placeholder
 * the archive demonstration already uses further down the page, and the
 * captions carry the same [Subject] markers as the rest of the site.
 *
 * To put real work in: drop the files in public/marketing/hero/ and give the
 * frame a `src` and an `alt`. Everything else -- depth, drift, the caption --
 * keeps working. A frame with a `src` renders the photograph; a frame without
 * one renders its placeholder. Both are the same box, so the composition does
 * not move when the pictures land.
 */
export interface Frame {
  /** Set once a licensed photograph exists. Until then the placeholder shows. */
  readonly src?: string;
  readonly alt?: string;
  /** Which placeholder treatment, when there is no photograph yet. */
  readonly tone: 1 | 2 | 3 | 4;
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
    { tone: 1, caption: "[Subject] · Sunset Tower", meta: "11:08 PM · exclusive 48h", tall: true },
    { tone: 3, caption: "[Subject] · valet", meta: "Licensed $1,800" },
    { tone: 2, caption: "[Subject] · Melrose", meta: "2024 · archive" },
  ],
  [
    { tone: 4, caption: "[Franchise] premiere", meta: "2022 · 5 sets on file" },
    { tone: 2, caption: "[Subject] · arrivals", meta: "Daily Mail · opened", tall: true },
    { tone: 1, caption: "[Subject] · courthouse", meta: "Rights match · evidence saved" },
  ],
  [
    { tone: 3, caption: "[Subject] · coffee run", meta: "2019 · repitched" },
    { tone: 1, caption: "[Subject] · airport", meta: "6 pitches · 2 exclusive" },
    { tone: 4, caption: "[Subject] · after-party", meta: "Paid net 30", tall: true },
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
              className={`reel-frame tone-${frame.tone}${frame.tall ? " tall" : ""}`}
              key={`${column}-${index}`}
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
