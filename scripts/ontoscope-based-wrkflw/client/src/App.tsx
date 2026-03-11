import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";

import { TooltipProvider } from "@/components/ui/tooltip";
import { SessionProvider } from "@/context/session-context";
import OntoScope from "@/pages/ontochat";
import SamodWorkbench from "@/pages/samod-workbench";
import WorkflowHome from "@/pages/workflow-home";
import FormalizationPage from "@/pages/formalization";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={WorkflowHome} />
      <Route path="/samod" component={SamodWorkbench} />
      <Route path="/ontoscope" component={OntoScope} />
      <Route path="/formalization" component={FormalizationPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <SessionProvider>
          <Router />
        </SessionProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
