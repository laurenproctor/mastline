# Sending a package to a picture desk

`docs/DECISIONS.md` recorded the hole: *"Mastline records a dispatch; it does
not yet transmit to a buyer's systems."* This is how a package reaches a desk
without one — and, just as importantly, how Mastline stops claiming it did
things it did not do.

An editor does not adopt software. They open a link. So a delivery is a link —
unguessable, dated, withdrawable, made for one recipient, and watched.

## The seven facts

Mastline used to record one thing and report seven. Approving a package set the
package to `delivered`, the submission to `sent`, stamped `sent_at`, wrote an
event reading “Sent to <buyer>”, and moved the shoot to `dispatched` — all
before a link existed and before a single byte had left. These are now seven
separate facts, and each is written by the thing that actually evidences it:

| Fact | What writes it |
| --- | --- |
| Package approved | An operator confirming the approval. Package `approved`, submission `queued`, `sent_at` null. |
| Link created | An operator making a link for one recipient. Nothing else moves. |
| Link shared | An operator pressing **Mark as shared**. Submission `sent`, package `sending`, shoot `dispatched`. |
| Link opened | The first valid open. Submission `delivered`, package `delivered`. |
| Photographs viewed | Bounded heartbeats from the delivery page, where consent allows. |
| Terms accepted | The visitor typing their name. Submission `acknowledged`. |
| Frame downloaded | An append-only access event. |

**Copying a link is not sharing it.** The copy control writes nothing to the
server and says so: *“Link copied. Mastline has not marked it as shared.”* A
control that quietly marked the link as shared would make “Shared” mean
“somebody looked at the address”, which is not what a photographer reads it as.

## One link per recipient

A submission carries as many links as the photographer needs — one per desk,
agency, editor, or channel. Each has its own token, recipient, expiry, share
timestamp, activity, sessions, views, acceptances, and downloads, and can be
withdrawn on its own. That separation is the point: it is what makes “the link
created for the New York picture desk was opened” a thing Mastline can say.

The recipient label and any contact reference live in protected columns and
**never appear in the URL**. A query string ends up in browser history, in a
referrer header, and in every proxy log between Mastline and the desk, which is
no place for the name of a person.

Attribution parameters do go in the URL — `campaign=awards-season`,
`desk=new-york` — because they carry nothing personal. At most eight per link,
validated in the server action and again by a database check constraint, and
frozen once the link is marked shared. Keys that could be mistaken for a
credential (`token`, `sig`, `expires`), for a person (`email`, `name`,
`contact`), or that would poison a JavaScript prototype (`__proto__`) are
refused. Nothing reads them to decide anything: the token is the only
credential and it is a path segment, so the honest answer to “can a parameter
override authorization?” is “there is no parameter by that name”.

What a visitor types into the query string changes what is in their address bar
and nothing in the record. The photographer's screen reads the snapshot stored
beside the link.

## What a recipient sees

The recipient opens `/d/<token>` with no account and no password. They see the
package name, the credit, the terms, any embargo, and every frame with its
caption. Each frame offers a full-resolution download once the terms are
accepted.

Every open, every download, and every refusal is recorded with the time and the
address it came from, and shown back to the photographer on the submission —
which is what `/security` promises.

## Nothing here transmits anything

There is no email sender, no SFTP client, and no agency portal integration.
There used to be a **Retry delivery** button that inserted a row with status
`sending` and told the operator “Attempt 2 recorded and queued.” Nothing was
queued: no worker existed to drain it and no code path would ever have moved
that attempt off `sending`. It was a database insert wearing the costume of a
transmission, and it is gone. Attempts an external system genuinely made and
reported through the delivery webhook remain visible as read-only evidence.

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

## Accepting the terms

The full file follows the yes, not the link. A recipient sees the frames and the
terms, types their name, and accepts; only then do the downloads appear. Trying
before that is refused and recorded, so a desk that went looking is visible
rather than silent.

Acceptance is not a new state. `submission_status` already had `acknowledged`
and submissions already carried `acknowledged_at`; until now only an operator
could set them, from their side of the conversation. This lets the person who
actually accepted do it, and it only moves forward — a package already sold is
not walked back by someone opening an old link.

What is kept is the whole of what they agreed to, copied at the moment they
agreed: a later disagreement is about the words on the screen that day, not the
words in the package today. One acceptance per link, because accepting twice is
the same yes.

This is the hinge the commercial record was missing. A package went out and the
next event was a photographer typing a licence in by hand; now there is a dated,
attributed, evidenced moment to attach that licence and its payment to.

## What is not built

- **The full-resolution download is not marked**, deliberately. A desk that
  licenses a frame needs a clean file; the gate there is acceptance.
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


## Measuring what a desk actually looked at

The access record answered “did they open it” and “did they take a copy”. It
could not answer the question a photographer actually asks, which is whether
anybody *looked*: an open is one row whether the editor read every caption or
closed the tab in half a second.

So the delivery page measures viewing time, first-party, with the server
deciding what counts.

**Time accrues only while all four hold**: the document is visible (Page
Visibility, so a background tab is not viewing), the window has focus, there has
been pointer, key, scroll, or touch activity in the last two minutes, and the
photograph is at least half in the viewport. A tab left open over a weekend
adds nothing.

**Nothing the browser says is trusted.** Every figure is a claim from a
stranger, and three separate defences bound it:

* a **ceiling** — no single heartbeat is worth more than 30 seconds, whatever
  it claims;
* the **wall clock** — a beat cannot count more time than has actually passed
  since the previous one, plus two seconds of grace for a late timer;
* a **monotonic sequence** — a beat at or below the highest already seen is a
  replay and counts zero.

Between them, sending the same beat a thousand times adds the time once, and
claiming an hour in a ten-second beat adds ten seconds.

**The visitor identity is pseudonymous and scoped to one link.** The browser
generates a random handle; the server hashes the delivery id into it, so the
same browser opening two links is two unrelated visitors and nothing can join
them up. No fingerprinting: no canvas, no fonts, no hardware properties. The IP
address is never the visitor id.

**What is deliberately not collected**: pointer paths, keystrokes, the name
typed into the acceptance, scroll depth, clipboard contents, session replay, or
anything about browsing elsewhere. There is no Google Analytics, no Meta Pixel,
and no third-party tag on this page.

### Essential evidence vs optional analytics

| Recorded always | Recorded only where consent allows |
| --- | --- |
| Link opened, refused | Viewing sessions |
| Terms accepted, and the terms as shown | Active visible time |
| Frames downloaded | Per-photograph time and view counts |
| Time and IP address of each of the above | Repeat-visit linkage within one link |

The left column is commercial evidence — the photographer's record of what a
buyer did with their work, and in the acceptance's case a record of an
agreement. It is recorded whatever the visitor chooses. The right column is
engagement measurement: useful, not necessary to operate the delivery, and
behind the same choice as everything else optional. Where a choice is required
and has not been made, the delivery page renders no tracker at all and says so
on the page.

### Missing measurement is not zero engagement

Three states, kept distinct, because collapsing them is how an analytics screen
starts lying:

* **Not opened yet** — no evidence of anything.
* **The link was opened, but detailed viewing time was unavailable** — the page
  was fetched and no heartbeat arrived: consent withheld, a blocker, a tab
  closed instantly. Unknown, not zero.
* **Opened, with no active viewing time recorded yet** — heartbeats arrived and
  none of them counted.

Durations are labelled approximate wherever they appear, because they are.

### Retention

Detailed session and per-frame rows are the privacy-sensitive half and can be
pruned on a schedule with `prune_delivery_analytics(retain_days)`, service role
only. Durable rollups are written alongside the detail rather than derived from
it, so pruning costs the session-by-session breakdown and none of the totals: a
photographer keeps “the New York desk spent about four minutes across three
visits” long after the individual visits are gone.

Nothing here is a legal conclusion. Whether dwell time on a delivery page is
caught by any particular regime, and how long it may be kept, are questions for
review rather than ones this document answers.

## A link, not a person

A recipient-specific token identifies the intended recipient, not the human
holding it. Links get forwarded; desks share logins. So the interface says:

> Viewed through the link created for New York picture desk

and never:

> Jane viewed this for 43 seconds

The single exception is acceptance, where somebody types their own name. That
is an explicit identification and is reported as one, on its own line, with the
terms they saw at the time.
