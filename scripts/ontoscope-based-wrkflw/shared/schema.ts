import { z } from "zod";

export const insertUserSchema = z.object({
  username: z.string(),
  password: z.string(),
});

export const insertCQSessionSchema = z.object({
  domain: z.string(),
});

export const insertDimensionValueSchema = z.object({
  sessionId: z.string().nullable().optional(),
  dimension: z.string(),
  value: z.string(),
});

export const insertCompetencyQuestionSchema = z.object({
  sessionId: z.string().nullable().optional(),
  question: z.string(),
  domainCoverage: z.string(),
  terminologyGranularity: z.string(),
  suggestedTerms: z.array(z.string()).optional(),
  type: z.string().nullable().optional(),
  x: z.number(),
  y: z.number(),
});

export const insertDeletedDimensionValueSchema = z.object({
  sessionId: z.string().nullable().optional(),
  dimension: z.string(),
  value: z.string(),
});

export const insertDeletedTerminologySchema = z.object({
  sessionId: z.string().nullable().optional(),
  terminology: z.string(),
});

export const insertDeletedCompetencyQuestionSchema = z.object({
  sessionId: z.string().nullable().optional(),
  question: z.string(),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type InsertCQSession = z.infer<typeof insertCQSessionSchema>;
export type InsertDimensionValue = z.infer<typeof insertDimensionValueSchema>;
export type InsertCompetencyQuestion = z.infer<typeof insertCompetencyQuestionSchema>;
export type InsertDeletedDimensionValue = z.infer<typeof insertDeletedDimensionValueSchema>;
export type InsertDeletedTerminology = z.infer<typeof insertDeletedTerminologySchema>;
export type InsertDeletedCompetencyQuestion = z.infer<typeof insertDeletedCompetencyQuestionSchema>;

export interface User {
  id: string;
  username: string;
  password: string;
}

export interface CQSession {
  id: string;
  domain: string;
  createdAt: Date | null;
}

export interface DimensionValue {
  id: string;
  sessionId: string | null;
  dimension: string;
  value: string;
  isRelevant: boolean | null;
}

export interface CompetencyQuestion {
  id: string;
  sessionId: string | null;
  question: string;
  domainCoverage: string;
  terminologyGranularity: string;
  suggestedTerms: string[] | null;
  type: string | null;
  isRelevant: boolean | null;
  x: number;
  y: number;
}

export interface DeletedDimensionValue {
  id: string;
  sessionId: string | null;
  dimension: string;
  value: string;
  deletedAt: Date | null;
}

export interface DeletedTerminology {
  id: string;
  sessionId: string | null;
  terminology: string;
  deletedAt: Date | null;
}

export interface DeletedCompetencyQuestion {
  id: string;
  sessionId: string | null;
  question: string;
  deletedAt: Date | null;
}

export const storyEntityTypeSchema = z.enum([
  "actor",
  "system",
  "event",
  "constraint",
  "source_ref",
]);

export const storyStatusSchema = z.enum(["draft", "ready_for_cq"]);

export const storyEntitySchema = z.object({
  id: z.string(),
  label: z.string().min(1),
  type: storyEntityTypeSchema,
  evidence: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  status: z.enum(["pending", "accepted", "rejected"]).default("pending"),
});

export const storyProvenanceSchema = z.object({
  model: z.string(),
  promptVersion: z.string(),
  extractedAt: z.string(),
});

export const insertStorySchema = z.object({
  title: z.string().min(1),
  narrative: z.string().min(1),
  domain: z.string().optional(),
  status: storyStatusSchema.optional(),
});

export type StoryEntityType = z.infer<typeof storyEntityTypeSchema>;
export type StoryStatus = z.infer<typeof storyStatusSchema>;
export type StoryEntity = z.infer<typeof storyEntitySchema>;
export type StoryProvenance = z.infer<typeof storyProvenanceSchema>;
export type InsertStory = z.infer<typeof insertStorySchema>;

export interface Story {
  id: string;
  title: string;
  narrative: string;
  domain: string | null;
  status: StoryStatus;
  entities: StoryEntity[];
  provenance: StoryProvenance | null;
  createdAt: Date;
  updatedAt: Date;
}

export type CQTraceStage = "samod_step1" | "ontoscope_manual";

export interface CQTraceLink {
  id: string;
  sessionId: string;
  cqId: string;
  storyId: string | null;
  stage: CQTraceStage;
  createdAt: Date;
}

export interface InsertCQTraceLink {
  sessionId: string;
  cqId: string;
  storyId?: string | null;
  stage: CQTraceStage;
}

export interface GlossaryEntry {
  id: string;
  sessionId: string;
  term: string;
  definition: string;
  source: "auto" | "user";
  updatedAt: Date;
}

export interface InsertGlossaryEntry {
  sessionId: string;
  term: string;
  definition: string;
  source?: "auto" | "user";
}
