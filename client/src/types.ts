// Re-export the shared contract so client code imports from one place.
export * from "@shared/processGraph.ts";

export interface DiagramSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}
