"use client";

import Image from "next/image";
import { useActionState, useMemo, useState } from "react";
import {
  ONBOARDING_GOALS,
  SALES_ENGINE_TERMS_VERSION,
  SPECIALTIES,
  WORK_STYLES,
  specialtyLabel,
} from "@/lib/onboarding";
import { SLUG_MAX_LENGTH, slugProblem } from "@/lib/slug";
import { DEFAULT_TIMEZONE, WORKSPACE_TIMEZONES, formatTimezone } from "@/lib/timezones";
import { slugifyWorkspace } from "@/lib/validation";
import { type OnboardingState, createWorkspaceAction } from "./actions";

const INITIAL: OnboardingState = {};

const STEPS = [
  "Welcome",
  "Your work",
  "Workspace URL",
  "Priorities",
  "First shoot",
  "Review",
  "Rights",
  "Ready",
] as const;

const SAMPLE_IMAGES = [
  "/onboarding/sample-shoot-01.webp",
  "/onboarding/sample-shoot-02.webp",
  "/onboarding/sample-shoot-03.webp",
] as const;

type WorkspaceTimezone = (typeof WORKSPACE_TIMEZONES)[number];

function Arrow() {
  return (
    <svg
      aria-hidden="true"
      className="onboarding-arrow"
      fill="none"
      height="14"
      viewBox="0 0 18 14"
      width="18"
    >
      <path d="M1 7h15M11 2l5 5-5 5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function Progress({ step }: { step: number }) {
  return (
    <nav aria-label="Onboarding progress" className="onboarding-progress">
      <ol>
        {STEPS.map((label, index) => {
          const state = index < step ? "complete" : index === step ? "current" : "upcoming";
          return (
            <li
              aria-current={state === "current" ? "step" : undefined}
              data-state={state}
              key={label}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              <b>{label}</b>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function ChoiceButton({
  active,
  description,
  label,
  onClick,
}: {
  active: boolean;
  description: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button aria-pressed={active} className="onboarding-choice" onClick={onClick} type="button">
      <span className="choice-state">{active ? "Selected" : "Select"}</span>
      <strong>{label}</strong>
      <small>{description}</small>
    </button>
  );
}

export function OnboardingFlow({
  email,
  suggestedName,
  trialLabel,
}: {
  email: string;
  suggestedName: string;
  trialLabel: string;
}) {
  const [state, formAction, pending] = useActionState(createWorkspaceAction, INITIAL);
  const [step, setStep] = useState(0);
  const [workspaceName, setWorkspaceName] = useState(suggestedName);
  const [timezone, setTimezone] = useState<WorkspaceTimezone>(DEFAULT_TIMEZONE);
  const [slug, setSlug] = useState(() => slugifyWorkspace(suggestedName));
  // Until the address is edited by hand it tracks the name, so somebody who
  // renames their studio on the previous step does not find the old one here.
  // After that it is theirs, and typing a new name must not overwrite it.
  const [slugEdited, setSlugEdited] = useState(false);
  const effectiveSlug = slugEdited ? slug : slugifyWorkspace(workspaceName);
  const slugIssue = slugProblem(effectiveSlug);
  const [workStyle, setWorkStyle] = useState("independent");
  const [city, setCity] = useState("New York, NY");
  const [specialties, setSpecialties] = useState<string[]>(["celebrity", "street_style"]);
  const [goals, setGoals] = useState<string[]>(["organize", "dispatch", "editorial"]);
  const [shootMode, setShootMode] = useState<"sample" | "folder" | "upcoming">("sample");
  const [selectedFrame, setSelectedFrame] = useState(0);
  const [subject, setSubject] = useState("Mara Voss");
  const [shootDate, setShootDate] = useState("2026-08-24");
  const [location, setLocation] = useState("SoHo, New York");
  const [visibleBrands, setVisibleBrands] = useState("The Row, Bottega Veneta");
  const [createdByUser, setCreatedByUser] = useState("yes");
  const [restrictions, setRestrictions] = useState("none");
  // Off unless the photographer turns it on. This governs the 70/30 split, so
  // a pre-ticked box would be consent nobody actually gave.
  const [salesEngine, setSalesEngine] = useState(false);

  const selectedGoalLabels = useMemo(
    () => ONBOARDING_GOALS.filter((goal) => goals.includes(goal.key)).map((goal) => goal.label),
    [goals],
  );

  function toggleList(value: string, current: string[], update: (items: string[]) => void) {
    update(
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    );
  }

  /**
   * Why this step cannot be left yet, or null.
   *
   * The same rules run again in `parseOnboarding` on the server, because a
   * disabled button is a courtesy and not a control.
   */
  function blockedReason(current: number): string | null {
    if (current === 1) {
      if (!workspaceName.trim()) return "Give the workspace a name.";
      if (!city.trim()) return "Say where you are mostly based.";
      if (specialties.length === 0) return "Choose at least one kind of work.";
      return null;
    }
    if (current === 2) {
      if (!effectiveSlug) return "Choose a workspace address.";
      if (slugIssue === "invalid") {
        return `Use lowercase letters, numbers and hyphens, up to ${SLUG_MAX_LENGTH} characters.`;
      }
      if (slugIssue === "reserved") return "That address is reserved. Choose another.";
      return null;
    }
    if (current === 3 && goals.length === 0) return "Choose at least one priority.";
    return null;
  }

  const blocked = blockedReason(step);

  function next() {
    if (blockedReason(step)) return;
    setStep((current) => Math.min(STEPS.length - 1, current + 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function back() {
    setStep((current) => Math.max(0, current - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <main className="onboarding-page" id="main">
      <header className="onboarding-head">
        <Image alt="Mastline" height={204} priority src="/mastline-wordmark.png" width={1194} />
        <p>
          Signed in as <strong>{email}</strong>
        </p>
      </header>

      <Progress step={step} />

      <section
        aria-labelledby={`onboarding-title-${step}`}
        className={`onboarding-stage step-${step}`}
      >
        {step === 0 && (
          <div className="welcome-layout">
            <div className="welcome-copy">
              <p className="onboarding-eyebrow">Welcome to Mastline</p>
              <h1 id="onboarding-title-0">Your pictures should work as hard as you do.</h1>
              <p className="onboarding-lede">
                Set up the operating record behind your shoots, submissions, rights, and revenue. We
                will start with one real piece of work.
              </p>
              <button className="onboarding-primary" onClick={next} type="button">
                Set up my workspace
                <Arrow />
              </button>
              <p className="trial-line">{trialLabel}</p>
            </div>
            <div className="welcome-image">
              <Image
                alt="A professional photographer working on a SoHo street"
                fill
                priority
                sizes="(max-width: 900px) 100vw, 48vw"
                src="/onboarding/photographer-soho.webp"
              />
              <p>One commercial memory for every frame.</p>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="onboarding-content split-content">
            <div className="stage-intro">
              <p className="onboarding-eyebrow">Your work</p>
              <h1 id="onboarding-title-1">How do you work?</h1>
              <p>
                Mastline will use this to shape your workspace, defaults, and daily queue. You can
                change everything later.
              </p>
              <dl className="quiet-facts">
                <div>
                  <dt>Entered once</dt>
                  <dd>Inherited across shoots and assets</dd>
                </div>
                <div>
                  <dt>Visible to</dt>
                  <dd>You and people you invite</dd>
                </div>
              </dl>
            </div>
            <div className="stage-form">
              <label className="onboarding-field" htmlFor="onboarding-workspace-name">
                <span>Workspace name</span>
                <input
                  aria-label="Workspace name"
                  id="onboarding-workspace-name"
                  onChange={(event) => setWorkspaceName(event.target.value)}
                  required
                  value={workspaceName}
                />
                <small>Your studio or business name.</small>
              </label>
              <label className="onboarding-field" htmlFor="onboarding-city">
                <span>Primary city or territory</span>
                <input
                  id="onboarding-city"
                  onChange={(event) => setCity(event.target.value)}
                  value={city}
                />
              </label>
              <label className="onboarding-field" htmlFor="onboarding-timezone">
                <span>Workspace timezone</span>
                <select
                  id="onboarding-timezone"
                  onChange={(event) => setTimezone(event.target.value as WorkspaceTimezone)}
                  value={timezone}
                >
                  {WORKSPACE_TIMEZONES.map((zone) => (
                    <option key={zone} value={zone}>
                      {formatTimezone(zone)}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset className="choice-fieldset">
                <legend>Working model</legend>
                <div className="choice-grid two">
                  {WORK_STYLES.map((style) => (
                    <ChoiceButton
                      active={workStyle === style.key}
                      description={style.description}
                      key={style.key}
                      label={style.label}
                      onClick={() => setWorkStyle(style.key)}
                    />
                  ))}
                </div>
              </fieldset>
              <fieldset className="choice-fieldset compact-fieldset">
                <legend>Commonly photographed</legend>
                <div className="chip-row">
                  {SPECIALTIES.map((specialty) => (
                    <button
                      aria-pressed={specialties.includes(specialty.key)}
                      key={specialty.key}
                      onClick={() => toggleList(specialty.key, specialties, setSpecialties)}
                      type="button"
                    >
                      {specialty.label}
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="onboarding-content split-content">
            <div className="stage-intro">
              <p className="onboarding-eyebrow">Workspace URL</p>
              <h1 id="onboarding-title-2">Where your workspace lives.</h1>
              <p>
                This is the address you will work at, and the one you send people when you share a
                shoot or a submission. It is yours: nobody else can take it, now or later.
              </p>
              <dl className="quiet-facts">
                <div>
                  <dt>Changeable</dt>
                  <dd>Up to three times a year, in Settings</dd>
                </div>
                <div>
                  <dt>Old links</dt>
                  <dd>Keep working if you ever change it</dd>
                </div>
              </dl>
            </div>
            {/*
             * .stage-form is a grid, and its rows stretch to fill the column.
             * Every other step has enough fields that the rows come out at
             * their natural height; this one has a single field, so without
             * this the input grows to about a hundred pixels tall and the note
             * beneath it drifts to the bottom of the screen.
             */}
            <div className="stage-form" style={{ alignContent: "start" }}>
              <label className="onboarding-field" htmlFor="onboarding-slug">
                <span>Workspace address</span>
                <input
                  aria-describedby="onboarding-slug-hint"
                  aria-label="Workspace address"
                  aria-invalid={slugIssue !== null}
                  autoCapitalize="none"
                  autoCorrect="off"
                  id="onboarding-slug"
                  inputMode="url"
                  maxLength={SLUG_MAX_LENGTH}
                  onChange={(event) => {
                    setSlugEdited(true);
                    // Typed as it will be stored, so the preview underneath is
                    // the address rather than an approximation of it.
                    setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"));
                  }}
                  required
                  spellCheck={false}
                  value={effectiveSlug}
                />
                <small id="onboarding-slug-hint">
                  {slugIssue === "reserved" ? (
                    <>That address is reserved. Choose another.</>
                  ) : slugIssue === "invalid" ? (
                    <>Lowercase letters, numbers and hyphens, up to {SLUG_MAX_LENGTH} characters.</>
                  ) : (
                    <>
                      Your workspace will be at <strong>mastline.co/{effectiveSlug}</strong>
                    </>
                  )}
                </small>
              </label>
              <p className="section-note">
                Suggested from your workspace name. Change it to anything you would rather have —
                your own name works well if you shoot under it.
              </p>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="onboarding-content">
            <div className="wide-intro">
              <p className="onboarding-eyebrow">Priorities</p>
              <h1 id="onboarding-title-3">What should Mastline handle first?</h1>
              <p>
                Select every job that matters. We will use the choices to order your workspace—not
                hide anything from you.
              </p>
            </div>
            <div className="goal-list">
              {ONBOARDING_GOALS.map((goal, index) => (
                <button
                  aria-pressed={goals.includes(goal.key)}
                  key={goal.key}
                  onClick={() => toggleList(goal.key, goals, setGoals)}
                  type="button"
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{goal.label}</strong>
                  <small>{goal.description}</small>
                  <b>{goals.includes(goal.key) ? "Selected" : "Select"}</b>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="shoot-first-layout">
            <aside className="stage-intro dark-intro">
              <p className="onboarding-eyebrow">First shoot</p>
              <h1 id="onboarding-title-4">Start with one shoot.</h1>
              <p>
                Give Mastline a recent folder, plan an upcoming job, or use the sample set to see
                the workflow.
              </p>
              <div className="shoot-mode-list">
                <button
                  aria-pressed={shootMode === "folder"}
                  onClick={() => setShootMode("folder")}
                  type="button"
                >
                  <span>01</span>
                  <b>Import a folder</b>
                  <small>Opens the real importer once your workspace exists</small>
                </button>
                <button
                  aria-pressed={shootMode === "upcoming"}
                  onClick={() => setShootMode("upcoming")}
                  type="button"
                >
                  <span>02</span>
                  <b>Create an upcoming shoot</b>
                  <small>Begin with the brief and add files later</small>
                </button>
                <button
                  aria-pressed={shootMode === "sample"}
                  onClick={() => setShootMode("sample")}
                  type="button"
                >
                  <span>03</span>
                  <b>Use the sample shoot</b>
                  <small>A fictional SoHo arrival set</small>
                </button>
              </div>
              <p className="shoot-mode-note">
                Nothing is uploaded here. Files are hashed in your browser and written to private
                storage by the importer, which opens as soon as the workspace exists.
              </p>
            </aside>
            <div className="shoot-preview">
              <div className="shoot-preview-head">
                <span>Preview</span>
                <b>
                  {shootMode === "sample"
                    ? "SoHo arrival — demonstration"
                    : shootMode === "folder"
                      ? "Your folder, after setup"
                      : "Upcoming shoot"}
                </b>
              </div>
              <div className="preview-filmstrip">
                {SAMPLE_IMAGES.map((image, index) => (
                  <div key={image}>
                    <Image alt={`Sample shoot frame ${index + 1}`} fill sizes="30vw" src={image} />
                  </div>
                ))}
              </div>
              <dl className="extraction-list">
                <div>
                  <dt>Subject</dt>
                  <dd>Suggested after import</dd>
                </div>
                <div>
                  <dt>Capture date</dt>
                  <dd>Read from original metadata</dd>
                </div>
                <div>
                  <dt>Location</dt>
                  <dd>Suggested for your confirmation</dd>
                </div>
                <div>
                  <dt>Visible brands</dt>
                  <dd>Labeled suggestions only</dd>
                </div>
                <div>
                  <dt>Rights questions</dt>
                  <dd>Answered by you</dd>
                </div>
              </dl>
              <p className="privacy-line">
                Originals stay private · You approve every submission · Progress autosaves
              </p>
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="review-layout">
            <div className="review-visual">
              <div className="review-hero">
                <Image
                  alt="Mara Voss walking in SoHo"
                  fill
                  priority
                  sizes="65vw"
                  src={SAMPLE_IMAGES[selectedFrame]}
                />
              </div>
              <div className="review-strip">
                {SAMPLE_IMAGES.map((image, index) => (
                  <button
                    aria-label={`View sample frame ${index + 1}`}
                    aria-pressed={selectedFrame === index}
                    className={selectedFrame === index ? "active" : ""}
                    key={image}
                    onClick={() => setSelectedFrame(index)}
                    type="button"
                  >
                    <Image alt="" fill sizes="18vw" src={image} />
                  </button>
                ))}
              </div>
            </div>
            <div className="review-panel">
              <p className="onboarding-eyebrow">Review · demonstration</p>
              <h1 id="onboarding-title-5">Here’s what Mastline found.</h1>
              <p className="demo-banner" role="note">
                A worked example on sample pictures. Nothing here is saved, and any brand named is a
                suggestion for you to confirm on a real asset later — never recorded as fact.
              </p>
              <p className="review-note">
                Suggested from file metadata and image review. Confirm or edit before it becomes
                part of the record.
              </p>
              <label className="review-field" htmlFor="onboarding-subject">
                <span>Subject</span>
                <input
                  id="onboarding-subject"
                  onChange={(event) => setSubject(event.target.value)}
                  value={subject}
                />
              </label>
              <label className="review-field" htmlFor="onboarding-shoot-date">
                <span>Date</span>
                <input
                  id="onboarding-shoot-date"
                  onChange={(event) => setShootDate(event.target.value)}
                  type="date"
                  value={shootDate}
                />
              </label>
              <label className="review-field" htmlFor="onboarding-location">
                <span>Location</span>
                <input
                  id="onboarding-location"
                  onChange={(event) => setLocation(event.target.value)}
                  value={location}
                />
              </label>
              <label className="review-field" htmlFor="onboarding-brands">
                <span>Visible brands · suggestion</span>
                <input
                  id="onboarding-brands"
                  onChange={(event) => setVisibleBrands(event.target.value)}
                  value={visibleBrands}
                />
              </label>
              <div className="suggestion-basis">
                <span>Basis</span>
                <p>
                  Visual similarity, garment features, and prior confirmed records. Human
                  confirmation required.
                </p>
                <b>Medium confidence</b>
              </div>
            </div>
          </div>
        )}

        {step === 6 && (
          <div className="onboarding-content rights-layout">
            <div className="stage-intro">
              <p className="onboarding-eyebrow">Rights and readiness</p>
              <h1 id="onboarding-title-6">How can this work be used?</h1>
              <p>
                Mastline records the facts and routes decisions. It never turns a suggestion into a
                legal conclusion.
              </p>
              <div className="rights-principle">
                <strong>Your pictures remain yours.</strong>
                <p>
                  Mastline receives only the limited permission needed to store, process, deliver,
                  and—when you choose—help license the work.
                </p>
              </div>
            </div>
            <div className="rights-form">
              <fieldset>
                <legend>Did you or your team create these images?</legend>
                <label>
                  <input
                    checked={createdByUser === "yes"}
                    name="created"
                    onChange={() => setCreatedByUser("yes")}
                    type="radio"
                  />{" "}
                  Yes
                </label>
                <label>
                  <input
                    checked={createdByUser === "no"}
                    name="created"
                    onChange={() => setCreatedByUser("no")}
                    type="radio"
                  />{" "}
                  No or ownership is shared
                </label>
              </fieldset>
              <fieldset>
                <legend>Are any restrictions attached?</legend>
                <label>
                  <input
                    checked={restrictions === "none"}
                    name="restrictions"
                    onChange={() => setRestrictions("none")}
                    type="radio"
                  />{" "}
                  No known restrictions
                </label>
                <label>
                  <input
                    checked={restrictions === "agency"}
                    name="restrictions"
                    onChange={() => setRestrictions("agency")}
                    type="radio"
                  />{" "}
                  Agency, assignment, embargo, or exclusivity terms apply
                </label>
              </fieldset>
              <fieldset>
                <legend>Optional Mastline Sales Engine</legend>
                <label className="sales-engine-toggle">
                  <input
                    checked={salesEngine}
                    onChange={(event) => setSalesEngine(event.target.checked)}
                    type="checkbox"
                  />
                  <span>
                    <strong>Let Mastline surface licensing opportunities.</strong>
                    <small>
                      You approve every pitch, price, and license. You keep 70% only when Mastline
                      generates the sale; direct sales remain 100% yours. Recorded against terms
                      version {SALES_ENGINE_TERMS_VERSION}, and you can turn this off later.
                    </small>
                  </span>
                </label>
              </fieldset>
              <p className="rights-warning">
                Nothing is sent, licensed, invoiced, or escalated during setup.
              </p>
            </div>
          </div>
        )}

        {step === 7 && (
          <div className="ready-layout">
            <div className="ready-copy">
              <p className="onboarding-eyebrow">Ready</p>
              <h1 id="onboarding-title-7">Your first shoot is ready to work.</h1>
              <p>
                The sample set above is a demonstration — no shoot, asset, or rights record is
                created from it. Create the workspace and Mastline opens the real shoot intake,
                where your own files go through hashing, private storage, and registration.
              </p>
              <form action={formAction}>
                <input name="name" type="hidden" value={workspaceName} />
                <input name="workspaceSlug" type="hidden" value={effectiveSlug} />
                <input name="timezone" type="hidden" value={timezone} />
                <input name="workStyle" type="hidden" value={workStyle} />
                <input name="baseCity" type="hidden" value={city} />
                <input name="specialties" type="hidden" value={specialties.join(", ")} />
                <input name="goals" type="hidden" value={goals.join(", ")} />
                {salesEngine && <input name="salesEngine" type="hidden" value="on" />}
                {state.error && (
                  <div className="onboarding-error" role="alert">
                    <p>{state.error}</p>
                    {state.errors && (
                      <ul>
                        {Object.entries(state.errors).map(([field, message]) => (
                          <li key={field}>{message}</li>
                        ))}
                      </ul>
                    )}
                    <p className="onboarding-error-note">
                      Your answers are still here. Step back to change one, or try again.
                    </p>
                  </div>
                )}
                <button
                  aria-disabled={pending}
                  className="onboarding-primary"
                  disabled={pending}
                  type="submit"
                >
                  {pending ? "Creating workspace…" : "Create workspace and continue"}
                  {!pending && <Arrow />}
                </button>
              </form>
              <p className="trial-line">{trialLabel}</p>
            </div>
            <div className="ready-record">
              <div className="ready-image">
                <Image alt="Mara Voss sample shoot" fill sizes="45vw" src={SAMPLE_IMAGES[2]} />
              </div>
              <div className="ready-metrics">
                <div>
                  <span>Assets organized</span>
                  <strong>3</strong>
                  <small>Sample set</small>
                </div>
                <div>
                  <span>Ready for review</span>
                  <strong>3</strong>
                  <small>Metadata confirmed</small>
                </div>
                <div>
                  <span>Brand suggestions</span>
                  <strong>2</strong>
                  <small>Human review required</small>
                </div>
              </div>
              <dl className="ready-summary">
                <div>
                  <dt>Workspace</dt>
                  <dd>{workspaceName || "My Studio"}</dd>
                </div>
                <div>
                  <dt>Address</dt>
                  <dd>mastline.co/{effectiveSlug}</dd>
                </div>
                <div>
                  <dt>Based in</dt>
                  <dd>{city}</dd>
                </div>
                <div>
                  <dt>Primary work</dt>
                  <dd>{specialties.map(specialtyLabel).join(", ")}</dd>
                </div>
                <div>
                  <dt>Priorities</dt>
                  <dd>
                    {selectedGoalLabels.slice(0, 3).join(", ")}
                    {selectedGoalLabels.length > 3 ? ` +${selectedGoalLabels.length - 3}` : ""}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        )}
      </section>

      {step > 0 && step < STEPS.length - 1 && (
        <footer className="onboarding-actions">
          <button className="onboarding-back" onClick={back} type="button">
            Back
          </button>
          <p>
            Step {step + 1} of {STEPS.length}
          </p>
          <div className="onboarding-advance">
            {blocked && (
              <p className="onboarding-blocked" role="status">
                {blocked}
              </p>
            )}
            <button
              className="onboarding-primary"
              disabled={blocked !== null}
              onClick={next}
              type="button"
            >
              {step === 6 ? "Review setup" : "Continue"}
              <Arrow />
            </button>
          </div>
        </footer>
      )}
      {step === STEPS.length - 1 && (
        <button className="ready-back" onClick={back} type="button">
          Back to rights
        </button>
      )}
    </main>
  );
}
