import { ShieldAlert } from "lucide-react";
import type { ApprovalOption, PendingApproval } from "../../../shared/contracts";

export function ApprovalCard({ approval, onResolve }: {
  approval: PendingApproval;
  onResolve(option: ApprovalOption["id"]): void;
}): React.JSX.Element {
  return (
    <section className="attention-card approval-card">
      <div className="attention-icon"><ShieldAlert size={20} /></div>
      <div className="attention-copy">
        <span className="eyebrow">Approval needed</span>
        <h3>{approval.title}</h3>
        {approval.reason && <p>{approval.reason}</p>}
        {approval.detail && <pre>{approval.detail}</pre>}
        <div className="attention-actions">
          {approval.options.map((option) => (
            <button key={option.id} className={`button tone-${option.tone}`} type="button" onClick={() => onResolve(option.id)}>
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
