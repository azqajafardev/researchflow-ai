import type { SearchAssessment } from '~~/shared/utils/search-assessment'
import type { SearchPlan, SearchLimitation } from '~~/shared/utils/search-plan'
import type { ResearchFeedbackResult, ResearchLearning } from '~~/shared/types/research-session'

export type ResearchHistoryNodeStatus =
  | 'generating_query'
  | 'generating_query_reasoning'
  | 'generated_query'
  | 'reading_source'
  | 'searching'
  | 'search_complete'
  | 'processing_search_result'
  | 'processing_search_result_reasoning'
  | 'node_complete'
  | 'no_evidence'
  | 'error'

export interface ResearchHistoryGraphNode {
  id: string
  label: string
  researchGoal?: string
  searchPlan?: SearchPlan
  searchAttempt?: number
  searchAssessment?: SearchAssessment
  searchLimitations?: SearchLimitation[]
  generateQueriesReasoning?: string
  generateLearningsReasoning?: string
  searchResults?: Array<{ url: string; title?: string; publishedAt?: string; score?: number }>
  learnings?: ResearchLearning[]
  status?: ResearchHistoryNodeStatus
  error?: string
}

export interface ResearchHistoryGraph {
  nodes: ResearchHistoryGraphNode[]
  selectedNodeId?: string
}

export interface ResearchHistoryItem {
  id: string
  title: string
  query: string
  breadth: number
  depth: number
  numQuestions: number
  feedback: ResearchFeedbackResult[]
  learnings: ResearchLearning[]
  report: string
  /** Optional for backward compatibility with older history exports. */
  graph?: ResearchHistoryGraph
  createdAt: string
  updatedAt: string
}

export type NewResearchHistoryItem = Omit<ResearchHistoryItem, 'id' | 'createdAt' | 'updatedAt'>

export type ResearchHistoryItemUpdates = Partial<
  Omit<ResearchHistoryItem, 'id' | 'createdAt' | 'updatedAt'>
>

export interface ResearchHistory {
  items: ResearchHistoryItem[]
}
