import { Button } from "@/components/ui/button";

type StepId = "landing" | "stories" | "ontoscope" | "formalization";

interface WorkflowProgressProps {
  current: StepId;
  showNavButtons?: boolean;
}

const stepConfig: Array<{ id: StepId; label: string; path: string }> = [
  { id: "landing", label: "1. Setup", path: "/" },
  { id: "stories", label: "2. Stories & Informal CQs", path: "/samod" },
  { id: "ontoscope", label: "3. OntoScope", path: "/ontoscope" },
  { id: "formalization", label: "4. SPARQL & Glossary", path: "/formalization" },
];

export function WorkflowProgress({ current, showNavButtons = true }: WorkflowProgressProps) {
  const currentIndex = stepConfig.findIndex((step) => step.id === current);
  const prevStep = currentIndex > 0 ? stepConfig[currentIndex - 1] : null;
  const nextStep = currentIndex < stepConfig.length - 1 ? stepConfig[currentIndex + 1] : null;
  const sessionIdFromUrl = new URLSearchParams(window.location.search).get("sessionId");
  const activeSessionId = sessionIdFromUrl || sessionStorage.getItem("active_ontoscope_session_id");

  const navigateToStep = (path: string) => {
    if ((path === "/ontoscope" || path === "/formalization") && activeSessionId) {
      window.location.href = `${path}?sessionId=${encodeURIComponent(activeSessionId)}`;
      return;
    }
    window.location.href = path;
  };

  return (
    <div className="w-full bg-white border border-slate-200 rounded-md p-3">
      <div className="flex flex-wrap items-center gap-2">
        {stepConfig.map((step, index) => {
          const isCurrent = step.id === current;
          const isDone = index < currentIndex;
          return (
            <button
              key={step.id}
              className={`px-3 py-1 rounded-full text-xs font-medium border ${
                isCurrent
                  ? "bg-blue-600 text-white border-blue-600"
                  : isDone
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-slate-50 text-slate-600 border-slate-200"
              }`}
              onClick={() => {
                navigateToStep(step.path);
              }}
              type="button"
            >
              {step.label}
            </button>
          );
        })}
      </div>
      {showNavButtons && (
        <div className="mt-3 flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!prevStep}
            onClick={() => {
              if (prevStep) navigateToStep(prevStep.path);
            }}
          >
            Back
          </Button>
          <Button
            size="sm"
            disabled={!nextStep}
            onClick={() => {
              if (nextStep) navigateToStep(nextStep.path);
            }}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
