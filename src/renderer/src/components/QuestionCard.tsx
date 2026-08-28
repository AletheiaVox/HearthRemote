import { MessageCircleQuestion } from "lucide-react";
import { useMemo, useState } from "react";
import type { PendingQuestion } from "../../../shared/contracts";

export function QuestionCard({ request, onSubmit }: {
  request: PendingQuestion;
  onSubmit(answers: Record<string, string[]>): void;
}): React.JSX.Element {
  const initial = useMemo(() => Object.fromEntries(request.questions.map((question) => [question.id, [] as string[]])), [request]);
  const [answers, setAnswers] = useState<Record<string, string[]>>(initial);

  return (
    <section className="attention-card question-card">
      <div className="attention-icon"><MessageCircleQuestion size={20} /></div>
      <div className="attention-copy">
        <span className="eyebrow">Codex has a question</span>
        {request.questions.map((question) => (
          <fieldset key={question.id}>
            <legend><small>{question.header}</small>{question.question}</legend>
            {question.options?.map((option) => {
              const checked = answers[question.id]?.includes(option.label) ?? false;
              return (
                <label className={`question-option ${checked ? "selected" : ""}`} key={option.label}>
                  <input
                    type="radio"
                    name={question.id}
                    checked={checked}
                    onChange={() => setAnswers((value) => ({ ...value, [question.id]: [option.label] }))}
                  />
                  <span><strong>{option.label}</strong><small>{option.description}</small></span>
                </label>
              );
            })}
            {question.isOther && (
              <input
                className="free-answer"
                type={question.isSecret ? "password" : "text"}
                placeholder="Write your answer…"
                onChange={(event) => setAnswers((value) => ({ ...value, [question.id]: event.target.value ? [event.target.value] : [] }))}
              />
            )}
          </fieldset>
        ))}
        <div className="attention-actions">
          <button
            className="button tone-primary"
            type="button"
            disabled={request.questions.some((question) => !(answers[question.id]?.length))}
            onClick={() => onSubmit(answers)}
          >
            Send answer
          </button>
        </div>
      </div>
    </section>
  );
}
