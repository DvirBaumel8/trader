import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './client';

export interface KnowledgeRow {
  symbol: string;
  nodeCount: number;
  updatedAt: string;
  hasNew: boolean;
}
export interface KnowledgeSource {
  label: string;
  url: string;
}
export interface KnowledgeNode {
  id: string;
  title: string;
  text: string;
  type?: 'text' | 'fundamentals';
  asOf?: string;
  question?: string;
  sources?: KnowledgeSource[];
  createdAt: string;
  updatedAt: string;
}
export interface KnowledgeEdge {
  from: string;
  to: string;
  label: string;
}
export interface KnowledgeGraph {
  symbol: string;
  version: number;
  updatedAt: string;
  lastViewedAt: string | null;
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}

export const KNOWLEDGE_KEY = ['knowledge'] as const;

export function useKnowledgeList() {
  return useQuery({
    queryKey: KNOWLEDGE_KEY,
    queryFn: () => api<KnowledgeRow[]>('/knowledge'),
    refetchOnWindowFocus: true,
  });
}

export function useKnowledgeGraph(symbol: string) {
  return useQuery({
    queryKey: [...KNOWLEDGE_KEY, symbol],
    queryFn: async () => {
      try {
        return await api<KnowledgeGraph>(`/knowledge/${encodeURIComponent(symbol)}`);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
    refetchOnWindowFocus: true,
    // Drop the cache on leaving, so the next visit's first response carries
    // the lastViewedAt this visit just set (the screen's "new" highlights).
    gcTime: 0,
  });
}

/** Marks a graph viewed on the server, then refreshes the list's "new" dots. */
export function useMarkViewed() {
  const qc = useQueryClient();
  return useCallback(
    (symbol: string) => {
      api(`/knowledge/${encodeURIComponent(symbol)}/viewed`, { method: 'POST' })
        .then(() => qc.invalidateQueries({ queryKey: KNOWLEDGE_KEY, exact: true }))
        .catch(() => {});
    },
    [qc],
  );
}
