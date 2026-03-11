import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { WorkflowProgress } from "@/components/workflow-progress";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { toastError } from "@/lib/toast-error";

interface Step3DraftResponse {
  session: { id: string; domain: string };
  cqDrafts: Array<{
    cqId: string;
    question: string;
    type: "subject" | "property" | "object";
    sparql: string;
    termsUsed: string[];
  }>;
  glossary: Array<{
    id: string;
    term: string;
    definition: string;
    source: "auto" | "user";
  }>;
}

export default function FormalizationPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get("sessionId");
    if (sid) {
      setSessionId(sid);
      sessionStorage.setItem("active_ontoscope_session_id", sid);
    } else {
      const persistedSid = sessionStorage.getItem("active_ontoscope_session_id");
      if (persistedSid) setSessionId(persistedSid);
    }
    const stored = sessionStorage.getItem("ontoscope_api_key");
    if (stored) setApiKey(stored);
  }, []);

  const { data, isLoading } = useQuery<Step3DraftResponse>({
    queryKey: ["/api/cq-sessions", sessionId, "step3-draft"],
    enabled: !!sessionId,
    queryFn: async () => {
      const res = await fetch(`/api/cq-sessions/${sessionId}/step3-draft`);
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()) || "Failed to load step3 draft"}`);
      return res.json();
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/cq-sessions/${sessionId}/step3-generate`, {
        apiKey: apiKey || undefined,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cq-sessions", sessionId, "step3-draft"] });
    },
    onError: (error) => { toastError(error, "Failed to regenerate glossary"); },
  });

  const updateGlossaryMutation = useMutation({
    mutationFn: async (payload: { id: string; definition: string }) => {
      const response = await apiRequest("PATCH", `/api/glossary/${payload.id}`, {
        definition: payload.definition,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cq-sessions", sessionId, "step3-draft"] });
    },
    onError: (error) => { toastError(error, "Failed to save definition"); },
  });

  const glossaryById = useMemo(() => {
    const map = new Map<string, string>();
    (data?.glossary || []).forEach((entry) => map.set(entry.id, entry.definition));
    return map;
  }, [data?.glossary]);

  if (!sessionId) {
    return (
      <div className="min-h-screen bg-slate-100 p-6">
        <div className="mx-auto max-w-4xl space-y-4">
          <WorkflowProgress current="formalization" />
          <Card className="p-4">
            <p className="text-sm text-slate-700">No active session found. Go to Step 3 and create or open a session first.</p>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <WorkflowProgress current="formalization" />
        <Card className="p-4">
          <h1 className="text-xl font-semibold">Step 4: SPARQL & Glossary</h1>
          <p className="text-sm text-slate-600 mt-1">
            Uses Step 2 CQs and concepts to propose SPARQL drafts and editable glossary definitions.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Button onClick={() => regenerateMutation.mutate()} disabled={regenerateMutation.isPending}>
              {regenerateMutation.isPending ? "Generating..." : "Regenerate"}
            </Button>
            {!apiKey && (
              <p className="text-xs text-slate-500">
                No API key found from Step 1. Regeneration will use fallback definitions.
              </p>
            )}
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="text-lg font-semibold">CQ -&gt; SPARQL Drafts</h2>
          {isLoading && <p className="text-sm text-slate-600 mt-2">Loading drafts...</p>}
          {!isLoading && (data?.cqDrafts || []).length === 0 && (
            <p className="text-sm text-slate-600 mt-2">No CQ drafts available for this session.</p>
          )}
          <div className="mt-3 space-y-3">
            {(data?.cqDrafts || []).map((draft) => (
              <div key={draft.cqId} className="border rounded-md p-3 bg-white">
                <p className="font-medium">{draft.question}</p>
                <p className="text-sm text-slate-500 mt-1">type: {draft.type} | terms: {draft.termsUsed.join(", ")}</p>
                <Textarea value={draft.sparql} readOnly rows={6} className="mt-2 font-mono text-xs" />
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="text-lg font-semibold">Glossary (Editable)</h2>
          <div className="mt-3 space-y-3">
            {(data?.glossary || []).map((entry) => (
              <div key={entry.id} className="border rounded-md p-3 bg-white">
                <p className="font-medium">{entry.term}</p>
                <p className="text-xs text-slate-500 mt-1">source: {entry.source}</p>
                <Textarea
                  defaultValue={glossaryById.get(entry.id) || entry.definition}
                  rows={3}
                  className="mt-2"
                  onBlur={(e) => {
                    const value = e.target.value.trim();
                    if (value && value !== entry.definition) {
                      updateGlossaryMutation.mutate({ id: entry.id, definition: value });
                    }
                  }}
                />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
