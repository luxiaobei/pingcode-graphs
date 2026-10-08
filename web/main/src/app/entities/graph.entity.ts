import type { GraphNodeKind, RelationType } from '../enums/graph.enum';

export interface GraphWorkItem {
  id: string;
  identifier?: string;
  title?: string;
  type?: string | { id?: string; name?: string };
  state?: {
    id?: string;
    name?: string;
    type?: string;
  };
  project?: {
    id?: string;
    name?: string;
    identifier?: string;
  };
  priority?: {
    id?: string;
    name?: string;
  };
  assignee?: {
    id?: string;
    name?: string;
    display_name?: string;
  };
  depth?: number;
  kind?: GraphNodeKind;
  hiddenNeighborCount?: number;
  position?: { x: number; y: number };
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relationType: RelationType;
  label: string;
}

export interface DependencyGraph {
  rootId: string;
  depth: number;
  nodes: GraphWorkItem[];
  edges: GraphEdge[];
  criticalPath: string[];
}

export interface GetDependencyGraphPayload {
  workitemId?: string;
  depth?: number;
  relationTypes?: RelationType[];
}

export interface RelationStyle {
  label: string;
  color: string;
  canonical?: string;
}
