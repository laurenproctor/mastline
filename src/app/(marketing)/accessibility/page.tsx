import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Accessibility" };

export default function Page() {
  return (
    <>
      <section className="pagehead">
        <div className="wrap">
          <div className="crumb">
            <Link href="/">Home</Link> / Accessibility
          </div>
          <h1>Accessibility Statement</h1>
          <p className="lede">
            Mastline is built for people working fast, often one-handed, often in the dark. Mastline
            wants it to work for every photographer, including those who use assistive technology.
          </p>
        </div>
      </section>
      <section>
        <div className="wrap">
          <div className="legal">
            <p className="meta">Last updated August 21, 2026</p>

            <h2>Mastline’s commitment</h2>
            <p>
              Mastline is committed to making its website and application accessible to the widest
              possible audience, regardless of ability or technology. Mastline aims to conform to
              the <strong>Web Content Accessibility Guidelines (WCAG) 2.2, Level AA</strong>,
              treating accessibility as part of product quality rather than a separate compliance
              task.
            </p>

            <h2>What Mastline does</h2>
            <ul>
              <li>
                <strong>Keyboard access.</strong> Every feature, including pitching, accepting
                offers, and issuing licenses, can be operated with a keyboard alone, with a visible
                focus indicator at every step.
              </li>
              <li>
                <strong>Screen readers.</strong> Pages use semantic HTML, meaningful headings,
                labeled controls, and descriptive text alternatives for images and icons. Live
                updates, such as an exclusive window counting down or a new offer arriving, are
                announced without stealing focus.
              </li>
              <li>
                <strong>Color and contrast.</strong> Text and interface elements meet or exceed WCAG
                AA contrast ratios. Status is never conveyed by color alone; it is paired with text
                or shape.
              </li>
              <li>
                <strong>Motion.</strong> Animations are minimal, and the product respects your
                operating system’s “reduce motion” setting.
              </li>
              <li>
                <strong>Zoom and reflow.</strong> Layouts reflow at up to 400% zoom and on small
                screens without horizontal scrolling or loss of content.
              </li>
              <li>
                <strong>Forms and errors.</strong> Fields have visible labels, errors are described
                in text next to the field, and nothing times out without warning and a way to
                extend.
              </li>
              <li>
                <strong>Mobile.</strong> Touch targets are at least 44 by 44 pixels, and core flows
                work with one hand.
              </li>
              <li>
                <strong>Documents.</strong> Licenses, invoices, and exports are generated as tagged,
                machine-readable documents.
              </li>
            </ul>

            <h2>How Mastline works</h2>
            <p>
              Accessibility is reviewed at design, in code review, and before each release using
              automated checks and manual testing with keyboard navigation and screen readers
              including VoiceOver, NVDA, and TalkBack. Mastline periodically commissions independent
              accessibility audits and fix findings on defined timelines. Mastline’s team receives
              accessibility training as part of onboarding.
            </p>

            <h2>Known limitations</h2>
            <p>Mastline is honest about where Mastline is still improving. Currently:</p>
            <ul>
              <li>
                [KNOWN LIMITATION, e.g. “Some third-party embedded maps in Shoot Workspace are not
                fully navigable by keyboard. Mastline provides an accessible list view of the same
                locations and are working with the provider.”]
              </li>
              <li>[KNOWN LIMITATION]</li>
            </ul>
            <p>Mastline updates this list as issues are resolved.</p>

            <h2>Compatibility</h2>
            <p>
              Mastline is designed to work with current versions of Chrome, Safari, Firefox, and
              Edge, and with common assistive technologies on macOS, Windows, iOS, and Android. It
              may not perform optimally on browsers more than two major versions old.
            </p>

            <h2>Tell Mastline what’s not working</h2>
            <p>
              If you encounter a barrier, or if you need any part of Mastline, including a license
              or invoice, in an alternative format, please contact Mastline. Mastline aims to
              respond within two business days and to resolve barriers as quickly as Mastline can.
            </p>
            <p>
              Email: <a href="mailto:accessibility@mastline.co">accessibility@mastline.co</a>
              <br />
              Phone: [PHONE NUMBER]
              <br />
              Post: Storyworlding, 155 Prince Street, Floor 3, New York, NY 10012
            </p>

            <h2>Formal complaints</h2>
            <p>
              If you are not satisfied with Mastline’s response, you may escalate to Mastline’s Head
              of Product at <a href="mailto:accessibility@mastline.co">accessibility@mastline.co</a>
              . You may also have the right to raise a complaint with the relevant authority in your
              jurisdiction.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
