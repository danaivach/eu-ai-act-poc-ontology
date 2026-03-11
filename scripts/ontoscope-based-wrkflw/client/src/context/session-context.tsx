import { createContext, useContext, useEffect, useState } from "react";

interface SessionContextValue {
  apiKey: string;
  sessionId: string | null;
  domain: string;
}

const SessionContext = createContext<SessionContextValue>({
  apiKey: "",
  sessionId: null,
  domain: "",
});

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [apiKey, setApiKey] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [domain, setDomain] = useState("");

  useEffect(() => {
    const k = sessionStorage.getItem("ontoscope_api_key");
    if (k) setApiKey(k);
    const s = sessionStorage.getItem("active_ontoscope_session_id");
    if (s) setSessionId(s);
    const d = sessionStorage.getItem("samod_domain");
    if (d?.trim()) setDomain(d);
  }, []);

  return (
    <SessionContext.Provider value={{ apiKey, sessionId, domain }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}
