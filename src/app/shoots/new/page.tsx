import { AppShell } from "@/components/app-shell";
import { Badge, Field, PageHeader, Panel, PendingButton } from "@/components/primitives";
import { listBuyers } from "@/lib/mock/queries";

export default async function CreateShootPage() {
  const buyers = await listBuyers();

  return (
    <AppShell active="Shoots">
      <div className="page">
        <PageHeader
          description="Start with files or a brief. Facts entered here are inherited by assets, packages, and submissions."
          eyebrow="New record"
          title="Create shoot"
        />
        <div className="panel-grid">
          <div className="dropzone">
            <div>
              <div aria-hidden="true" className="dropzone-mark">
                ＋
              </div>
              <h2>Bring in the shoot</h2>
              <p>
                Drop a folder, card export, JPEGs, RAW files, or video clips. Originals are
                preserved untouched and delivery derivatives are created separately.
              </p>
              <div className="upload-options">
                <PendingButton>Choose folder</PendingButton>
                <PendingButton>Mobile upload</PendingButton>
                <PendingButton>Watch folder</PendingButton>
              </div>
              <div className="spacer" />
              <Badge tone="good">Private by default</Badge>
            </div>
          </div>

          <Panel action={<Badge tone="neutral">Draft</Badge>} title="Shoot brief">
            <div className="panel-body">
              <p className="section-note">
                A shoot can be created from a brief alone. Files are not required.
              </p>
              <div className="spacer" />
              <div className="form-grid">
                <Field full label="Subject or event" name="title" required />
                <Field label="Date and time" name="startsAt" type="datetime-local" />
                <Field control="select" defaultValue="high" label="Priority" name="priority">
                  <option value="urgent">Urgent</option>
                  <option value="high">High</option>
                  <option value="standard">Standard</option>
                  <option value="watch">Watch</option>
                </Field>
                <Field full label="Location" name="locationName" />
                <Field label="Photographer" name="photographer" />
                <Field
                  label="Assignment / agency"
                  name="assignmentLabel"
                  placeholder="Direct, Backgrid, Getty…"
                />
                <Field control="textarea" full label="Story angle" name="storyAngle" />
                <Field
                  control="select"
                  hint="Buyers you expect to pitch. Used to pre-fill the dispatch package."
                  label="Target buyer"
                  name="targetBuyer"
                >
                  {buyers.map((buyer) => (
                    <option key={buyer.id} value={buyer.id}>
                      {buyer.name}
                    </option>
                  ))}
                </Field>
                <Field label="Expected expenses" name="expectedExpenses" placeholder="$0.00" />
                <Field control="select" label="Exclusivity" name="exclusivity">
                  <option>None</option>
                  <option>Agency exclusive</option>
                  <option>Buyer exclusive</option>
                </Field>
                <Field label="Embargo" name="embargoUntil" placeholder="No embargo" />
                <Field
                  control="textarea"
                  full
                  hint="Stored separately and visible only to roles with source access. Never exposed through global search."
                  label="Confidential source note"
                  name="sourceNote"
                />
              </div>
              <div className="spacer" />
              <div className="actions">
                <PendingButton className="primary">Create shoot and review</PendingButton>
                <PendingButton>Save draft</PendingButton>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}
