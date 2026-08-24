# Sending a package to a picture desk

`docs/DECISIONS.md` recorded the hole: *"Mastline records a dispatch; it does
not yet transmit to a buyer's systems."* This is the transmission.

An editor does not adopt software. They open a link. So a delivery is a link —
unguessable, dated, withdrawable, and watched.

## What happens

The operator opens a submission and creates a link, choosing a recipient label
and how long it stays open (3, 7, 14, or 30 days). **Nothing is sent.** They get
a URL and pass it on themselves, because `CLAUDE.md` puts buyer communication
among the things a person has to decide to do.

The recipient opens `/d/<token>` with no account and no password. They see the
package name, the credit, the terms, any embargo, and every frame with its
caption. Each frame offers a full-resolution download.

Every open, every download, and every refusal is recorded with the time and the
address it came from, and shown back to the photographer on the submission —
which is what `/security` promises.

## How it is kept safe

**The token is the only credential**, so it is 32 bytes from a cryptographic
source, base64url, and never derived from anything about the submission.
Knowing one link tells you nothing about another.

**The recipient reaches nothing through row level security.** They have no
session, so there is nothing for RLS to decide. Everything arrives through three
`security definer` functions keyed on the token, and the narrowness is the
safety: no function accepts an organization id, and none returns an original, a
source note, a price, or a buyer's details.

**A frame must belong to the package.** Without that check the token would open
every asset in the workspace. Asking for one that does not is refused and
recorded.

**Downloads are authorised and logged by the same function**, before any file is
handed over, so there is no path that downloads without logging. Signing the URL
afterwards runs with the service role: the caller is anonymous and has, rightly,
no rights of their own on a private bucket.

**An unknown token, a withdrawn link, and an expired one give the same page.**
Telling a stranger which it was tells them something about a link they do not
hold. A browser test asserts the two pages are byte-identical.

**The access record is append-only.** A record that can be tidied afterwards is
not evidence. `purge_delivery_links()` is the audited exception, service-role
only, and it exists because the test suite creates links on every run.

## The mark on a preview

Every frame a recipient sees is marked with **their own name and the date the
link was made**. That is the point of it: a watermark does not stop a
screenshot, it makes the screenshot attributable, so a frame that turns up
somewhere it should not traces back to the desk it went to.

The buyer page used to hand out a signed URL straight to the stored preview,
which put the clean file one right-click away. Previews go through
`/d/<token>/preview/<assetId>` now, validated by the same token check as
everything else here, so the only version a recipient can reach carries their
name. A browser test asserts the image source is that route and never a storage
URL.

Marked once per delivery and cached in the private bucket, because the mark
names the recipient and cannot be shared between links, but a desk scrolling the
page should not re-render it each time. Withdrawing a link stops the marked
preview being served too, not just the page.

The overlay is diagonal repeated text plus a bar along the bottom carrying the
credit and the terms, at an opacity chosen so a picture editor can still judge
the frame — a preview nobody can assess does not get bought. Text is escaped:
"O'Brien Picture Desk" would otherwise produce invalid SVG and fail the whole
render.

Previews fall back to the delivery derivative when no preview version exists,
which is the common case for a RAW file the browser could not decode at import.
The route scales to 1400px on the long edge before marking, so falling back
never means quietly handing over the full file.

`sharp` is a direct dependency now, at 0.35.3 rather than the 0.34.5 Next
bundles: everything below 0.35.0 carries four high-severity libvips CVEs.

## What is not built

- **No acceptance.** The marketing copy describes "one button to accept". A
  recipient can look and download; recording an acceptance against the
  submission is the obvious next step. Until it exists, the second half of the
  `/security` sentence -- full resolution released "only through a time-limited
  link tied to an accepted license" -- is not true: the download is gated by the
  link, not by acceptance.
- **The full-resolution download is not marked**, deliberately. A desk that
  licenses a frame needs a clean file; the gate there is acceptance, not a
  watermark.
- **No email.** By design for now: the operator passes the link on.
- **Nothing expires the signed file URL early.** The redirect is good for five
  minutes; a recipient who saves it has it for those five minutes.

## Notes from building it

The seed creates `asset_versions` rows but uploads no bytes, so downloads are
correctly a 404 until something is actually stored. The browser test stands a
real 1×1 JPEG behind the seeded delivery version and takes it away afterwards,
and it asks the database where the file belongs rather than assuming the path —
guessing it once cost a confusing 404.

Supabase refuses unqualified `DELETE`, even inside a function, which is why the
purge has `where id is not null` on both statements.
