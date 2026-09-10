export type StepState = "done" | "active" | "idle";

export function Step({
  index, state, title, tag, detail, children,
}: {
  index: number;
  state: StepState;
  title: string;
  tag?: React.ReactNode;
  detail?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className={`step ${state}`}>
      <div className="step-marker">{state === "done" ? "✓" : index}</div>
      <div className="step-body">
        <div className="step-title">
          {title}
          {tag}
        </div>
        {detail && <div className="step-detail">{detail}</div>}
        {children && <div className="step-action">{children}</div>}
      </div>
    </div>
  );
}

export const OriginTag = () => <span className="chain-tag origin">Sepolia</span>;
export const CreditcoinTag = () => <span className="chain-tag creditcoin">Creditcoin</span>;
export const AttestcoinTag = () => <span className="chain-tag attestcoin">Attestcoin</span>;
