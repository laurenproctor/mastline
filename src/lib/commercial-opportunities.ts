export type CommercialOpportunityStage = "needs_review" | "in_review" | "pitch_ready" | "won";

export type ProductMatchKind = "Exact match" | "Probable match" | "Similar style";

export interface CommercialProductMatch {
  readonly id: string;
  readonly name: string;
  readonly brand: string;
  readonly detail: string;
  readonly price: string;
  readonly confidence: number;
  readonly match: ProductMatchKind;
  readonly image: string;
}

export interface CommercialOpportunity {
  readonly id: string;
  readonly assetId: string;
  readonly subject: string;
  readonly item: string;
  readonly brand: string;
  readonly match: "Exact" | "Probable";
  readonly score: number;
  readonly age: string;
  readonly location: string;
  readonly capturedAt: string;
  readonly filename: string;
  readonly stage: CommercialOpportunityStage;
  readonly image: string;
  readonly products: readonly CommercialProductMatch[];
}

/**
 * Visual prototype fixtures. Product recognition is suggestion-only: a human
 * confirms every match before Mastline prepares a pitch or commerce package.
 */
export const COMMERCIAL_OPPORTUNITIES: readonly CommercialOpportunity[] = [
  {
    id: "mara-vale-tribeca",
    assetId: "ast_commercial_mara_0012",
    subject: "Mara Vale",
    item: "Trench coat",
    brand: "Burberry",
    match: "Probable",
    score: 92,
    age: "18 min",
    location: "Tribeca, New York",
    capturedAt: "Aug 21, 2026 · 10:06 AM ET",
    filename: "MST_20260821_MARA_0012.JPG",
    stage: "needs_review",
    image: "/commercial/mara-vale-tribeca.webp",
    products: [
      {
        id: "mara-trench",
        name: "Cotton gabardine trench",
        brand: "Burberry",
        detail: "Heritage long trench in stone",
        price: "$2,590",
        confidence: 93,
        match: "Probable match",
        image: "/commercial/cream-trench.webp",
      },
      {
        id: "mara-sunglasses",
        name: "Acetate sunglasses",
        brand: "Celine",
        detail: "Triomphe-frame sunglasses",
        price: "$510",
        confidence: 71,
        match: "Probable match",
        image: "/commercial/black-sunglasses.webp",
      },
      {
        id: "mara-tote",
        name: "Structured tote",
        brand: "Métier",
        detail: "Roma leather bag in oxblood",
        price: "$3,450",
        confidence: 60,
        match: "Similar style",
        image: "/commercial/woven-bag.webp",
      },
    ],
  },
  {
    id: "julian-cross-soho",
    assetId: "ast_commercial_julian_0012",
    subject: "Julian Cross",
    item: "Suede jacket",
    brand: "Brunello Cucinelli",
    match: "Exact",
    score: 87,
    age: "41 min",
    location: "SoHo, New York",
    capturedAt: "Aug 21, 2026 · 9:43 AM ET",
    filename: "MST_20260821_JULIAN_0012.JPG",
    stage: "needs_review",
    image: "/commercial/julian-cross-soho.webp",
    products: [
      {
        id: "julian-jacket",
        name: "Suede blouson jacket",
        brand: "Brunello Cucinelli",
        detail: "Dark-brown lamb suede",
        price: "$6,950",
        confidence: 91,
        match: "Exact match",
        image: "/commercial/suede-jacket.webp",
      },
      {
        id: "julian-sunglasses",
        name: "SL 276 MICA sunglasses",
        brand: "Saint Laurent",
        detail: "Black acetate, color 001",
        price: "$450",
        confidence: 74,
        match: "Probable match",
        image: "/commercial/black-sunglasses.webp",
      },
      {
        id: "julian-trousers",
        name: "Slim wool trousers",
        brand: "The Row",
        detail: "Black wool twill",
        price: "$1,190",
        confidence: 58,
        match: "Similar style",
        image: "/commercial/black-trousers.webp",
      },
    ],
  },
  {
    id: "nia-hart-west-village",
    assetId: "ast_commercial_nia_0012",
    subject: "Nia Hart",
    item: "Shoulder bag",
    brand: "Bottega Veneta",
    match: "Probable",
    score: 81,
    age: "2 hr",
    location: "West Village, New York",
    capturedAt: "Aug 21, 2026 · 8:24 AM ET",
    filename: "MST_20260821_NIA_0012.JPG",
    stage: "in_review",
    image: "/commercial/nia-hart-west-village.webp",
    products: [
      {
        id: "nia-bag",
        name: "Woven shoulder bag",
        brand: "Bottega Veneta",
        detail: "Intrecciato leather hobo",
        price: "$4,600",
        confidence: 84,
        match: "Probable match",
        image: "/commercial/woven-bag.webp",
      },
      {
        id: "nia-shirt",
        name: "Washed silk shirt",
        brand: "Vince",
        detail: "Charcoal silk blouse",
        price: "$395",
        confidence: 66,
        match: "Similar style",
        image: "/commercial/suede-jacket.webp",
      },
      {
        id: "nia-trousers",
        name: "Relaxed pleated trousers",
        brand: "Toteme",
        detail: "Charcoal wool blend",
        price: "$650",
        confidence: 61,
        match: "Similar style",
        image: "/commercial/black-trousers.webp",
      },
    ],
  },
  {
    id: "theo-ames-williamsburg",
    assetId: "ast_commercial_theo_0012",
    subject: "Theo Ames",
    item: "Sneakers",
    brand: "New Balance",
    match: "Exact",
    score: 79,
    age: "3 hr",
    location: "Williamsburg, New York",
    capturedAt: "Aug 21, 2026 · 7:14 AM ET",
    filename: "MST_20260821_THEO_0012.JPG",
    stage: "pitch_ready",
    image: "/commercial/theo-ames-williamsburg.webp",
    products: [
      {
        id: "theo-sneakers",
        name: "990 sneakers",
        brand: "New Balance",
        detail: "Gray suede and mesh",
        price: "$200",
        confidence: 96,
        match: "Exact match",
        image: "/commercial/gray-sneakers.webp",
      },
      {
        id: "theo-sweatshirt",
        name: "Loopback sweatshirt",
        brand: "Sunspel",
        detail: "Black cotton crewneck",
        price: "$195",
        confidence: 63,
        match: "Similar style",
        image: "/commercial/suede-jacket.webp",
      },
      {
        id: "theo-trousers",
        name: "Volume trousers",
        brand: "Studio Nicholson",
        detail: "Charcoal wool",
        price: "$495",
        confidence: 57,
        match: "Similar style",
        image: "/commercial/black-trousers.webp",
      },
    ],
  },
];

export function getCommercialOpportunity(id: string): CommercialOpportunity | undefined {
  return COMMERCIAL_OPPORTUNITIES.find((opportunity) => opportunity.id === id);
}
