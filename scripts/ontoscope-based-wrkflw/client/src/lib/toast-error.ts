import { toast } from "@/hooks/use-toast";

export function toastError(error: unknown, fallback = "Something went wrong"): void {
  const message = error instanceof Error ? error.message : fallback;
  toast({ title: "Error", description: message, variant: "destructive" });
}
