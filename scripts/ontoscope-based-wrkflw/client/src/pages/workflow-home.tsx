import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WorkflowProgress } from "@/components/workflow-progress";
export default function WorkflowHome() {
  const [tempApiKey, setTempApiKey] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionIdFromUrl = params.get("sessionId");
    if (sessionIdFromUrl) {
      window.location.href = `/ontoscope?sessionId=${encodeURIComponent(sessionIdFromUrl)}`;
      return;
    }

    const saved = sessionStorage.getItem("ontoscope_api_key");
    if (saved) setTempApiKey(saved);
  }, []);

  const saveKey = () => {
    const key = tempApiKey.trim();
    if (!key) return;
    sessionStorage.setItem("ontoscope_api_key", key);
  };

  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <WorkflowProgress current="landing" />
        <Card className="p-6">
          <h1 className="text-xl font-semibold">Ontology Workflow Setup</h1>
          <p className="text-sm text-slate-600 mt-1">
            Add your API key once, then move across steps without losing it.
          </p>
          <div className="mt-4 space-y-3">
            <div>
              <Label htmlFor="api-key">OpenAI API key</Label>
              <Input
                id="api-key"
                type="password"
                placeholder="sk-..."
                value={tempApiKey}
                onChange={(e) => setTempApiKey(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={saveKey} disabled={!tempApiKey.trim()}>
                Save key
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  saveKey();
                  window.location.href = "/samod";
                }}
                disabled={!tempApiKey.trim()}
              >
                Start Step 2
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
