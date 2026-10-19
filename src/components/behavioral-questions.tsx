"use client";

import { useState, useTransition, useCallback } from "react";
import { PrepSection } from "./prep-section";
import { generateQuestionsAction } from "@/actions/prep";
import { saveAnswer } from "@/actions/answers";

interface Question {
  id: string;
  question: string;
  rationale: string | null;
  userAnswer: string | null;
}

interface BehavioralQuestionsSectionProps {
  applicationId: string;
  questions: Question[];
}

export function BehavioralQuestionsSection({
  applicationId,
  questions,
}: BehavioralQuestionsSectionProps) {
  return (
    <PrepSection
      title="Behavioral Questions"
      hasContent={questions.length > 0}
      onGenerate={async () => {
        await generateQuestionsAction(applicationId);
      }}
    >
      {questions.length > 0 ? (
        <div className="space-y-4">
          {questions.map((q) => (
            <QuestionCard key={q.id} question={q} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border bg-white p-6 text-center text-sm text-gray-500">
          Click &quot;Generate&quot; to create company-specific behavioral
          questions.
        </div>
      )}
    </PrepSection>
  );
}

function QuestionCard({ question }: { question: Question }) {
  const [answer, setAnswer] = useState(question.userAnswer ?? "");
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleSave = useCallback(() => {
    if (answer === (question.userAnswer ?? "")) return;
    startTransition(async () => {
      await saveAnswer(question.id, answer);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  }, [answer, question.id, question.userAnswer]);

  return (
    <div className="rounded-lg border bg-white p-4">
      <p className="font-medium text-gray-900">{question.question}</p>
      {question.rationale && (
        <p className="mt-1 text-xs text-gray-500 italic">
          {question.rationale}
        </p>
      )}
      <textarea
        value={answer}
        onChange={(e) => {
          setAnswer(e.target.value);
          setSaved(false);
        }}
        onBlur={handleSave}
        placeholder="Write your answer/story here..."
        rows={3}
        className="mt-3 w-full resize-y rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
      <div className="mt-1 flex items-center justify-between">
        <span className="text-xs text-gray-400">
          {saved && "Saved ✓"}
          {isPending && "Saving..."}
        </span>
        <button
          onClick={handleSave}
          disabled={isPending || answer === (question.userAnswer ?? "")}
          className="rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:text-gray-400 disabled:hover:bg-transparent"
        >
          Save
        </button>
      </div>
    </div>
  );
}
