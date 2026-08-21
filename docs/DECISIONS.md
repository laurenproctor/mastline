# Decisions and open questions

## Settled

- Name: **Mastline**
- Category: business operating system / vertical SaaS for paparazzi
- Photographer-owned system of record; do not foreground “two-sided marketplace” language
- Selected wordmark direction: black Mastline mark with blue camera/signal dot
- Core workflow and nine operating screens are established
- Final tiers: Solo, Pro, Studio, Agency
- Annual pricing: Solo $49/month billed annually; Pro $99; Studio $279; Agency custom
- Monthly pricing: Solo $59/month; Pro $119; Studio $339; Agency custom
- Pro is the most popular plan; “Start free” is the CTA for Solo, Pro, and Studio
- Storage/scale: Solo 250 GB and 1 photographer; Pro 1 TB; Studio up to 5 people and 5 TB shared; Agency flexible/custom
- Optional Mastline Sales Engine split: photographer 70%, Mastline 30%, only on licenses generated inside Mastline
- Human review before outbound or consequential actions
- Warm off-white/light editorial interface is the default product direction; blue is the primary action signal

## Implementation hypotheses — validate, do not treat as product facts

- Next.js + Supabase is the recommended first stack
- Supabase Auth rather than a separate identity vendor
- Three private storage buckets: originals, derivatives, evidence
- The light editorial command-center direction is primary; the dark version may become an optional field/night theme
- News Radar and Rights Matches begin as triage tools, not autonomous agents

## Unresolved product decisions

1. Free-trial duration, payment-method requirement, eligibility, and conversion mechanics
2. Storage overage economics
3. When the 30% Sales Engine share is earned: checkout completed, funds cleared, refund window passed, or payout made
4. Direct-license buyer experience and who is merchant of record
5. Rights-recovery fee percentage and operational/legal partner model
6. First agency/delivery integrations
7. Supported RAW/video formats at launch
8. Retention requirements for originals and evidence
9. Whether an operator can delete an original or only archive/tombstone it

## Strategic pushback

Do not launch with a promise to discover every unauthorized use or predict every valuable news moment. Those promises depend on a trusted asset/license record that does not yet exist. The sequence is philosophical as well as practical: Mastline should first help a photographer remember their own work before claiming it can interpret the world around that work.
