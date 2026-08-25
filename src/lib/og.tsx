import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ImageResponse } from "next/og";

/**
 * The shared social card.
 *
 * One card for the whole marketing site rather than one per page: the pages
 * share a promise, and a per-page card is only worth its cost once individual
 * pages are being shared on their own merits. When that day comes, this takes a
 * headline argument and each route passes its own.
 *
 * The fonts are committed under src/lib/og-fonts rather than fetched at build.
 * next/font caches Google's files as woff2, which satori cannot parse, and
 * fetching TTFs during the build would make a deploy depend on fonts.gstatic
 * being reachable. Both faces are SIL Open Font License, so shipping them is
 * fine. The wordmark is inlined as a data URI because satori resolves no
 * relative URLs.
 */

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";
export const OG_ALT =
  "Mastline — the business operating system for paparazzi. Every shoot, sale, and dollar in one place.";

const FONT_DIR = join(process.cwd(), "src", "lib", "og-fonts");

function font(file: string): Buffer {
  return readFileSync(join(FONT_DIR, file));
}

function wordmarkDataUri(): string {
  const png = readFileSync(join(process.cwd(), "public", "mastline-wordmark.png"));
  return `data:image/png;base64,${png.toString("base64")}`;
}

/** The editorial palette, from marketing.css. Paper, ink, hairline, acid. */
const PAPER = "#f6f4ef";
const INK = "#121212";
const INK_3 = "#5b5b5b";
const RULE = "#d8d4ca";
const ACID = "#89ff0a";

const LIFECYCLE = ["Shoot", "Asset", "Submission", "License", "Payment"];

export function socialCard(): ImageResponse {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: PAPER,
        color: INK,
        padding: "64px 72px",
        fontFamily: "Inter",
      }}
    >
      {/* Masthead: wordmark against the address, divided by a hairline. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingBottom: 32,
          borderBottom: `1px solid ${RULE}`,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- satori renders img, not next/image */}
        <img alt="Mastline" src={wordmarkDataUri()} width={246} height={42} />
        <div
          style={{
            display: "flex",
            fontSize: 17,
            fontWeight: 600,
            letterSpacing: "0.18em",
            color: INK_3,
          }}
        >
          MASTLINE.CO
        </div>
      </div>

      {/* The promise, set the way the page sets it. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          justifyContent: "center",
          paddingRight: 40,
        }}
      >
        <div
          style={{
            display: "flex",
            fontFamily: "Newsreader",
            fontWeight: 600,
            fontSize: 78,
            lineHeight: 1.04,
            letterSpacing: "-0.02em",
          }}
        >
          The business operating system for paparazzi
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 26,
            fontSize: 29,
            color: INK_3,
            letterSpacing: "-0.01em",
          }}
        >
          Every shoot, sale, and dollar in one place.
        </div>
      </div>

      {/* The lifecycle, which is the product's actual claim. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          paddingTop: 30,
          borderTop: `1px solid ${RULE}`,
        }}
      >
        <div style={{ display: "flex", width: 14, height: 14, background: ACID }} />
        {LIFECYCLE.map((step, index) => (
          <div
            key={step}
            style={{
              display: "flex",
              marginLeft: index === 0 ? 18 : 14,
              fontSize: 18,
              fontWeight: 600,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: index === LIFECYCLE.length - 1 ? INK : INK_3,
            }}
          >
            {index === 0 ? step : `— ${step}`}
          </div>
        ))}
      </div>
    </div>,
    {
      ...OG_SIZE,
      fonts: [
        { name: "Inter", data: font("Inter-Regular.ttf"), weight: 400, style: "normal" },
        { name: "Inter", data: font("Inter-SemiBold.ttf"), weight: 600, style: "normal" },
        { name: "Newsreader", data: font("Newsreader-SemiBold.ttf"), weight: 600, style: "normal" },
      ],
    },
  );
}
