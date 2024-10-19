import { searchAssessmentSchema, type SearchAssessment } from '~~/shared/utils/search-assessment'
import {
  searchPlanSchema,
  type SearchPlan,
  type SearchLimitation,
} from '~~/shared/utils/search-plan'
import { researchLearningSchema } from '~~/shared/utils/research-learning'
import { z } from 'zod'
import { createFlowEdge, createFlowNode } from '~/utils/research-graph'
import { parentNodeId } from '~/utils/tree-node'
import type { ResearchHistoryGraph, ResearchHistoryGraphNode } from '~/types/history'

export const researchHistoryNodeStatusSchema = z.enum([
  'generating_query',
  'generating_query_reasoning',
  'generated_query',
  'searching',
  'search_complete',
  'processing_search_result',
  'processing_search_result_reasoning',
  'node_complete',
  'no_evidence',
  'error',
])

const researchHistorySearchResultSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  publishedAt: z.string().optional(),
  score: z.number().optional(),
})

export const researchHistoryGraphNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  researchGoal: z.string().optional(),
  searchPlan: searchPlanSchema.optional(),
  searchAssessment: searchAssessmentSchema.optional(),
  searchAttempt: z.number().int().min(1).max(2).optional(),
  searchLimitations: z.array(z.enum(['news', 'time', 'domains', 'language'])).optional(),
  generateQueriesReasoning: z.string().optional(),
  generateLearningsReasoning: z.string().optional(),
  searchResults: z.array(researchHistorySearchResultSchema).optional(),
  learnings: z.array(researchLearningSchema).optional(),
  status: researchHistoryNodeStatusSchema.optional(),
  error: z.string().optional(),
})

export const researchHistoryGraphSchema = z.object({
  nodes: z.array(researchHistoryGraphNodeSchema).min(1),
  selectedNodeId: z.string().optional(),
})

export type FlowSearchNodeData = {
  title: string
  status?: ResearchHistoryGraphNode['status']
}

export function serializeResearchHistoryNode(node: {
  id: string
  label: string
  researchGoal?: string
  searchPlan?: SearchPlan
  searchAttempt?: number
  searchAssessment?: SearchAssessment
  searchLimitations?: SearchLimitation[]
  generateQueriesReasoning?: string
  generateLearningsReasoning?: string
  searchResults?: Array<{
    url: string
    title?: string
    content?: string
    publishedAt?: string
    score?: number
  }>
  learnings?: ResearchHistoryGraphNode['learnings']
  status?: ResearchHistoryGraphNode['status']
  error?: string
}): ResearchHistoryGraphNode {
  return {
    id: node.id,
    label: node.label,
    researchGoal: node.researchGoal,
    ...(node.searchPlan
      ? {
          searchPlan: {
            ...node.searchPlan,
            ...(node.searchPlan.includeDomains
              ? { includeDomains: [...node.searchPlan.includeDomains] }
              : {}),
          },
        }
      : {}),
    ...(node.searchAssessment ? { searchAssessment: { ...node.searchAssessment } } : {}),
    ...(node.searchAttempt ? { searchAttempt: node.searchAttempt } : {}),
    ...(node.searchLimitations?.length ? { searchLimitations: [...node.searchLimitations] } : {}),
    generateQueriesReasoning: node.generateQueriesReasoning,
    generateLearningsReasoning: node.generateLearningsReasoning,
    // Persist only URL metadata for visited pages to keep localStorage small.
    searchResults: node.searchResults?.map(({ url, title, publishedAt, score }) => ({
      url,
      ...(title ? { title } : {}),
      ...(publishedAt ? { publishedAt } : {}),
      ...(score !== undefined ? { score } : {}),
    })),
    learnings: node.learnings?.map((learning) => ({ ...learning })),
    status: node.status,
    error: node.error,
  }
}

export function createResearchHistoryGraph(
  nodes: Parameters<typeof serializeResearchHistoryNode>[0][],
  selectedNodeId?: string,
): ResearchHistoryGraph {
  return {
    nodes: nodes.map(serializeResearchHistoryNode),
    selectedNodeId,
  }
}

export function projectFlowFromHistoryNodes(nodes: ResearchHistoryGraphNode[]) {
  const flowNodes = nodes.map((node) =>
    createFlowNode<FlowSearchNodeData>(node.id, {
      title: node.label || (node.id === '0' ? 'Start' : ''),
      status: node.status,
    }),
  )

  const flowEdges = nodes.flatMap((node) => {
    const parentId = parentNodeId(node.id)
    return parentId ? [createFlowEdge(parentId, node.id)] : []
  })

  return { flowNodes, flowEdges }
}

export function collectSearchResultsFromHistoryNodes(nodes: ResearchHistoryGraphNode[]) {
  const searchResults: Record<string, { learnings?: ResearchHistoryGraphNode['learnings'] }> = {}
  for (const node of nodes) {
    if (node.learnings?.length) {
      searchResults[node.id] = {
        learnings: node.learnings.map((learning) => ({ ...learning })),
      }
    }
  }
  return searchResults
}

export function restoreResearchHistoryGraph(graph: ResearchHistoryGraph) {
  const nodes = graph.nodes.map((node) => ({
    ...node,
    // History stores URL metadata only; runtime WebSearchResult requires content.
    searchResults: node.searchResults?.map((item) => ({
      ...item,
      content: '',
    })),
    learnings: node.learnings?.map((learning) => ({ ...learning })),
  }))
  const selectedNodeId =
    graph.selectedNodeId && nodes.some((node) => node.id === graph.selectedNodeId)
      ? graph.selectedNodeId
      : undefined
  const { flowNodes, flowEdges } = projectFlowFromHistoryNodes(nodes)

  return {
    nodes,
    selectedNodeId,
    searchResults: collectSearchResultsFromHistoryNodes(nodes),
    flowNodes,
    flowEdges,
  }
}
