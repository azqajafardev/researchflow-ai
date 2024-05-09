export interface ResearchHistoryItem {
  id: string
  title: string
  query: string
  breadth: number
  depth: number
  numQuestions: number
  feedback: Array<{
    assistantQuestion: string
    userAnswer: string
  }>
  learnings: Array<{
    url: string
    title?: string
    learning: string
  }>
  report: string
  createdAt: string
  updatedAt: string
}

export interface ResearchHistory {
  items: ResearchHistoryItem[]
}
