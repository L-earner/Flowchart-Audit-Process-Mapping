import Icon from "./Icon";

export type StepId = "capture" | "map" | "review" | "export";

export interface StepState {
  id: StepId;
  label: string;
  /** Short status shown under the label, e.g. "14 steps" or "5 to confirm". */
  status?: string;
  done: boolean;
  /** Draw attention (e.g. open points waiting). */
  attention?: boolean;
  disabled?: boolean;
}

/**
 * The app's workflow drawn as a small process flow: Capture → Map → Review →
 * Export. Selecting a step shows its panel; completed steps get a tick.
 */
export default function Stepper({
  steps,
  active,
  onSelect,
}: {
  steps: StepState[];
  active: StepId;
  onSelect: (id: StepId) => void;
}) {
  return (
    <nav className="pf-stepper" aria-label="Workflow">
      <ol>
        {steps.map((step, i) => (
          <li key={step.id} className={step.id === active ? "active" : ""}>
            {i > 0 && <span className={`pf-step-link ${steps[i - 1].done ? "done" : ""}`} aria-hidden="true" />}
            <button
              type="button"
              onClick={() => onSelect(step.id)}
              disabled={step.disabled}
              aria-current={step.id === active ? "step" : undefined}
            >
              <span className={`pf-step-dot ${step.done ? "done" : ""} ${step.attention ? "attention" : ""}`}>
                {step.done && step.id !== active ? <Icon name="check" size={12} /> : i + 1}
              </span>
              <span className="pf-step-text">
                <span className="pf-step-label">{step.label}</span>
                {step.status && <span className="pf-step-status">{step.status}</span>}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
