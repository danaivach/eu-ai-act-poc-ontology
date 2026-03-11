import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { WorkflowProgress } from "@/components/workflow-progress";
import type { Story } from "@shared/schema";

interface StoriesResponse {
  stories: Story[];
}

interface InformalCQSuggestion {
  question: string;
  coverageTag: "actor" | "system" | "event" | "constraint";
  type: "subject" | "property" | "object";
  storyId: string;
  entityLabels: string[];
  suggestedTerms?: string[];
}

interface PromoteResponse {
  sessionId: string;
}

interface DiscoveredSubdomain {
  label: string;
  confidence: number;
  sourceRepos: string[];
  evidence: string;
}

interface GenerationDebugContext {
  domain: string;
  storyIds: string[];
  maxQuestions: number;
  existingCQs: string[];
  storyInputs: Array<{
    storyId: string;
    title: string;
    narrative: string;
    entities: Array<{ label: string; type: string }>;
  }>;
}

export default function SamodWorkbench() {
  const [apiKey, setApiKey] = useState("");
  const [domain, setDomain] = useState("");
  const [title, setTitle] = useState("");
  const [narrative, setNarrative] = useState("");
  const [selectedStoryIds, setSelectedStoryIds] = useState<string[]>([]);
  const [generatedCQs, setGeneratedCQs] = useState<InformalCQSuggestion[]>([]);
  const [discoveredSubdomains, setDiscoveredSubdomains] = useState<DiscoveredSubdomain[]>([]);
  const [acceptedSubdomains, setAcceptedSubdomains] = useState<string[]>([]);
  const [discoverError, setDiscoverError] = useState("");
  const [discoverInfo, setDiscoverInfo] = useState("");
  const [maxRepos, setMaxRepos] = useState(8);
  const [storySubdomainOptions, setStorySubdomainOptions] = useState<Record<string, string[]>>({});
  const [persistedStories, setPersistedStories] = useState<Story[]>([]);
  const [generationDebug, setGenerationDebug] = useState<GenerationDebugContext | null>(null);
  const effectiveApiKey = apiKey.trim();

  useEffect(() => {
    const saved = sessionStorage.getItem("ontoscope_api_key");
    if (saved) setApiKey(saved);
    const savedDomain = sessionStorage.getItem("samod_domain");
    if (savedDomain?.trim()) setDomain(savedDomain);

    const persisted = sessionStorage.getItem("samod_state");
    if (persisted) {
      try {
        const parsed = JSON.parse(persisted);
        if (Array.isArray(parsed.discoveredSubdomains)) setDiscoveredSubdomains(parsed.discoveredSubdomains);
        if (Array.isArray(parsed.acceptedSubdomains)) setAcceptedSubdomains(parsed.acceptedSubdomains);
        if (Array.isArray(parsed.selectedStoryIds)) setSelectedStoryIds(parsed.selectedStoryIds);
        if (Array.isArray(parsed.generatedCQs)) setGeneratedCQs(parsed.generatedCQs);
        if (parsed.generationDebug && typeof parsed.generationDebug === "object") {
          setGenerationDebug(parsed.generationDebug);
        }
        if (parsed.storySubdomainOptions && typeof parsed.storySubdomainOptions === "object") {
          setStorySubdomainOptions(parsed.storySubdomainOptions);
        }
        if (typeof parsed.maxRepos === "number") setMaxRepos(parsed.maxRepos);
      } catch {
      }
    }

    const storedStories = sessionStorage.getItem("samod_stories");
    if (storedStories) {
      try {
        const parsedStories = JSON.parse(storedStories);
        if (Array.isArray(parsedStories)) setPersistedStories(parsedStories);
      } catch {
      }
    }
  }, []);

  useEffect(() => {
    if (domain.trim()) {
      sessionStorage.setItem("samod_domain", domain.trim());
    }
  }, [domain]);

  useEffect(() => {
    sessionStorage.setItem(
      "samod_state",
      JSON.stringify({
        discoveredSubdomains,
        acceptedSubdomains,
        selectedStoryIds,
        generatedCQs,
        generationDebug,
        storySubdomainOptions,
        maxRepos,
      }),
    );
  }, [discoveredSubdomains, acceptedSubdomains, selectedStoryIds, generatedCQs, generationDebug, storySubdomainOptions, maxRepos]);

  const { data } = useQuery<StoriesResponse>({
    queryKey: ["/api/stories"],
    enabled: true,
  });

  useEffect(() => {
    if (data?.stories && data.stories.length > 0) {
      setPersistedStories(data.stories);
      sessionStorage.setItem("samod_stories", JSON.stringify(data.stories));
    }
  }, [data?.stories]);

  const stories = (data?.stories && data.stories.length > 0) ? data.stories : persistedStories;

  const createStoryMutation = useMutation({
    mutationFn: async (payload: { title: string; narrative: string; domain: string }) => {
      const response = await apiRequest("POST", "/api/stories", payload);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stories"] });
      setTitle("");
      setNarrative("");
    },
  });

  const extractStoryMutation = useMutation({
    mutationFn: async (storyId: string) => {
      const response = await apiRequest("POST", `/api/stories/${storyId}/extract`, {
        apiKey: effectiveApiKey,
        candidateSubdomains: acceptedSubdomains,
      });
      return response.json();
    },
    onSuccess: (result, storyId) => {
      const linked = Array.isArray(result?.linkedSubdomains) ? result.linkedSubdomains : [];
      const suggested = Array.isArray(result?.suggestedSubdomains) ? result.suggestedSubdomains : [];
      const options = Array.from(new Set([...linked, ...suggested].map((x) => String(x).trim()).filter(Boolean)));

      if (options.length > 0) {
        setStorySubdomainOptions((prev) => ({ ...prev, [storyId]: options }));
      }

      if (suggested.length > 0) {
        setDiscoveredSubdomains((prev) => {
          const seen = new Set(prev.map((item) => item.label.toLowerCase()));
          const additions: DiscoveredSubdomain[] = suggested
            .map((label: string) => label.trim())
            .filter((label: string) => label.length > 0 && !seen.has(label.toLowerCase()))
            .map((label: string) => ({
              label,
              confidence: 0.6,
              sourceRepos: [],
              evidence: "Suggested from story extraction",
            }));
          return [...prev, ...additions];
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/stories"] });
    },
  });

  const generateInformalCQsMutation = useMutation({
    mutationFn: async (storyIds: string[]) => {
      const response = await apiRequest("POST", "/api/stories/generate-informal-cqs", {
        storyIds,
        apiKey: effectiveApiKey,
        maxQuestions: 10,
      });
      return response.json();
    },
    onSuccess: (result) => {
      setGeneratedCQs(result.suggestions || []);
      setGenerationDebug(result.debug || null);
    },
  });

  const discoverSubdomainsMutation = useMutation({
    mutationFn: async () => {
      setDiscoverError("");
      setDiscoverInfo("");
      const response = await apiRequest("POST", "/api/subdomains/discover", {
        domain: domain.trim() || "general",
        apiKey: effectiveApiKey,
        maxRepos,
      });
      return response.json();
    },
    onSuccess: (result) => {
      const list: DiscoveredSubdomain[] = result.subdomains || [];
      setDiscoveredSubdomains(list);
      setAcceptedSubdomains(list.slice(0, 5).map((item) => item.label));
      if (list.length === 0) {
        setDiscoverInfo("No subdomains discovered. Try a different domain phrase or run again.");
      } else {
        setDiscoverInfo(`Discovered ${list.length} subdomains from GitHub READMEs.`);
      }
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Discovery failed";
      setDiscoverError(message);
    },
  });

  const promoteToOntoScopeMutation = useMutation({
    mutationFn: async (): Promise<PromoteResponse> => {
      const normalized = generatedCQs
        .filter((cq) => cq.question?.trim())
        .map((cq) => ({
          question: cq.question.trim(),
          coverageTag: cq.coverageTag || "system",
          type: cq.type || "subject",
          storyId: cq.storyId || "samod",
          entityLabels: Array.isArray(cq.entityLabels) ? cq.entityLabels : [],
          suggestedTerms: Array.isArray(cq.suggestedTerms) ? cq.suggestedTerms : [],
        }));

      const response = await apiRequest("POST", "/api/samod/promote-to-ontoscope", {
        domain: domain.trim() || "SAMOD domain",
        acceptedSubdomains,
        cqs: normalized,
      });
      return response.json();
    },
    onSuccess: (result) => {
      sessionStorage.setItem("active_ontoscope_session_id", result.sessionId);
      window.location.href = `/ontoscope?sessionId=${encodeURIComponent(result.sessionId)}`;
    },
  });

  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <WorkflowProgress current="stories" />
        <Card className="p-4">
          <h1 className="text-xl font-semibold">SAMOD Workbench (Stories -&gt; Informal CQs)</h1>
          <p className="text-sm text-slate-600 mt-1">
            Step 1: curate stories. Step 2: generate story-conditioned informal competency questions.
          </p>
          <div className="mt-4">
            <Label htmlFor="domain">Domain</Label>
            <Input
              id="domain"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              disabled={!effectiveApiKey}
            />
            {!effectiveApiKey && (
              <div className="mt-3 flex items-center gap-2">
                <p className="text-sm text-slate-600">API key not found. Set it in Setup first.</p>
                <Button size="sm" variant="outline" onClick={() => (window.location.href = "/")}>
                  Go to Setup
                </Button>
              </div>
            )}
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="text-lg font-semibold">Discover subdomains from relevant GitHub projects</h2>
          <p className="text-sm text-slate-600 mt-1">
            Discover candidate subdomains to inspire stories and ontology scoping.
          </p>
          <div className="mt-3 flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Label htmlFor="max-repos" className="text-sm">Max repos</Label>
              <Input
                id="max-repos"
                type="number"
                min={1}
                max={30}
                value={maxRepos}
                onChange={(e) => {
                  const parsed = Number.parseInt(e.target.value, 10);
                  if (Number.isFinite(parsed)) {
                    setMaxRepos(Math.max(1, Math.min(30, parsed)));
                  }
                }}
                className="w-20"
              />
            </div>
            <Button
              onClick={() => discoverSubdomainsMutation.mutate()}
              disabled={!effectiveApiKey || !domain.trim() || discoverSubdomainsMutation.isPending}
            >
              {discoverSubdomainsMutation.isPending ? "Discovering..." : "Discover subdomains"}
            </Button>
            <p className="text-sm text-slate-500">
              Accepted: {acceptedSubdomains.length}
            </p>
          </div>
          {discoverError && (
            <p className="mt-2 text-sm text-red-600">{discoverError}</p>
          )}
          {!discoverError && discoverInfo && (
            <p className="mt-2 text-sm text-slate-600">{discoverInfo}</p>
          )}
          {discoveredSubdomains.length > 0 && (
            <div className="mt-4 space-y-2">
              {discoveredSubdomains.map((item) => {
                const checked = acceptedSubdomains.includes(item.label);
                return (
                  <div key={item.label} className="border rounded-md p-3 bg-white">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setAcceptedSubdomains((prev) => Array.from(new Set([...prev, item.label])));
                          } else {
                            setAcceptedSubdomains((prev) => prev.filter((value) => value !== item.label));
                          }
                        }}
                      />
                      <p className="font-medium">{item.label}</p>
                      <Badge variant="outline">confidence: {item.confidence.toFixed(2)}</Badge>
                    </div>
                    {item.evidence && (
                      <p className="text-sm text-slate-600 mt-2">{item.evidence}</p>
                    )}
                    {item.sourceRepos.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {item.sourceRepos.map((repo) => (
                          <a
                            key={repo}
                            href={`https://github.com/${repo}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex"
                          >
                            <Badge variant="secondary">{repo}</Badge>
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="text-lg font-semibold">Add story</h2>
          <div className="mt-3 space-y-3">
            <Input
              placeholder="Story title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <Textarea
              placeholder="Write a story ..."
              value={narrative}
              onChange={(e) => setNarrative(e.target.value)}
              rows={5}
            />
            <Button
              onClick={() =>
                createStoryMutation.mutate({
                  title: title.trim(),
                  narrative: narrative.trim(),
                  domain: domain.trim(),
                })
              }
              disabled={!title.trim() || !narrative.trim()}
            >
              Save story
            </Button>
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="text-lg font-semibold">Stories</h2>
          <div className="mt-3 space-y-3">
            {stories.length === 0 && <p className="text-sm text-slate-500">No stories yet.</p>}
            {stories.map((story) => {
              const isSelected = selectedStoryIds.includes(story.id);
              return (
                <div key={story.id} className="border rounded-md p-3 bg-white">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedStoryIds((prev) => [...prev, story.id]);
                            } else {
                              setSelectedStoryIds((prev) => prev.filter((id) => id !== story.id));
                            }
                          }}
                        />
                        <p className="font-medium">{story.title}</p>
                      </div>
                      <p className="text-sm text-slate-700 mt-2 whitespace-pre-wrap">{story.narrative}</p>
                      {storySubdomainOptions[story.id] && storySubdomainOptions[story.id].length > 0 && (
                        <div className="mt-3">
                          <p className="text-xs text-slate-500 mb-2">Story-related subdomains (click to include):</p>
                          <div className="flex flex-wrap gap-2">
                            {storySubdomainOptions[story.id].map((subdomain) => {
                              const checked = acceptedSubdomains.includes(subdomain);
                              return (
                                <label key={`${story.id}-${subdomain}`} className="inline-flex items-center gap-2 border rounded-md px-2 py-1 bg-slate-50">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setAcceptedSubdomains((prev) => Array.from(new Set([...prev, subdomain])));
                                      } else {
                                        setAcceptedSubdomains((prev) => prev.filter((value) => value !== subdomain));
                                      }
                                    }}
                                  />
                                  <span className="text-sm">{subdomain}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-2">
                      <Button
                        size="sm"
                        onClick={() => extractStoryMutation.mutate(story.id)}
                        disabled={!effectiveApiKey}
                      >
                        Extract subdomain links
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="text-lg font-semibold">Generate informal CQs</h2>
          <p className="text-sm text-slate-600 mt-1">
            Select ready stories and generate traceable informal CQs.
          </p>
          <div className="mt-3 flex items-center gap-3">
            <Button
              onClick={() => {
                const targetStoryIds =
                  selectedStoryIds.length > 0
                    ? selectedStoryIds
                    : stories.map((story) => story.id);
                generateInformalCQsMutation.mutate(targetStoryIds);
              }}
              disabled={!effectiveApiKey || (selectedStoryIds.length === 0 && stories.length === 0)}
            >
              Generate
            </Button>
            <Button
              variant="outline"
              onClick={() => promoteToOntoScopeMutation.mutate()}
              disabled={generatedCQs.length === 0 || promoteToOntoScopeMutation.isPending}
            >
              {promoteToOntoScopeMutation.isPending ? "Promoting..." : "Open in OntoScope"}
            </Button>
            <p className="text-sm text-slate-500">
              Stories: {stories.length} | Selected: {selectedStoryIds.length}
            </p>
          </div>
          <div className="mt-4 space-y-2">
            {generatedCQs.map((cq, index) => (
              <div key={`${cq.storyId}-${index}`} className="border rounded-md p-3 bg-white">
                <p className="font-medium">{cq.question}</p>
                <div className="mt-1 flex items-center gap-2 flex-wrap">
                  <Badge
                    variant="secondary"
                    className={`text-xs ${
                      cq.type === "subject"
                        ? "bg-blue-100 text-blue-800"
                        : cq.type === "property"
                        ? "bg-green-100 text-green-800"
                        : "bg-purple-100 text-purple-800"
                    }`}
                  >
                    {cq.type}
                  </Badge>
                  <span className="text-sm text-slate-600">coverage: {cq.coverageTag}</span>
                  <span className="text-sm text-slate-600">story: {cq.storyId}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(cq.suggestedTerms && cq.suggestedTerms.length > 0
                    ? cq.suggestedTerms
                    : cq.entityLabels
                  ).map((entityLabel) => (
                    <Badge key={entityLabel} variant="outline">
                      {entityLabel}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {generationDebug && (
            <div className="mt-4 border rounded-md p-3 bg-white">
              <h3 className="text-sm font-semibold">Generation debug context</h3>
              <p className="text-xs text-slate-600 mt-1">
                Domain: {generationDebug.domain} | stories: {generationDebug.storyIds.length} | maxQuestions: {generationDebug.maxQuestions}
              </p>
              <div className="mt-2">
                <p className="text-xs font-medium text-slate-700">Existing CQ/entity labels used as exclusion context:</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {generationDebug.existingCQs.map((item) => (
                    <Badge key={`debug-existing-${item}`} variant="secondary">{item}</Badge>
                  ))}
                </div>
              </div>
              <div className="mt-3 space-y-3">
                {generationDebug.storyInputs.map((story) => (
                  <div key={`debug-story-${story.storyId}`} className="border rounded-md p-2 bg-slate-50">
                    <p className="text-sm font-medium">{story.title}</p>
                    <p className="text-xs text-slate-600 mt-1">storyId: {story.storyId}</p>
                    <p className="text-xs text-slate-700 mt-2 whitespace-pre-wrap">{story.narrative}</p>
                    <div className="mt-2">
                      <p className="text-xs font-medium text-slate-700">Entities passed to model:</p>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {story.entities.map((entity, idx) => (
                          <Badge key={`debug-entity-${story.storyId}-${idx}`} variant="outline">
                            {entity.type}: {entity.label}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
