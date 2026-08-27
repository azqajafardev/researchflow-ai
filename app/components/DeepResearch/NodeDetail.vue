<script setup lang="ts">
  import type { DeepResearchNode } from './DeepResearch.vue'
  import { renderSafeMarkdown, toSafeHttpUrl } from '~/utils/markdown'

  defineProps<{
    node: DeepResearchNode
    disabled?: boolean
  }>()

  defineEmits<{
    (e: 'retry', nodeId: string): void
  }>()
</script>

<template>
  <div>
    <p
      v-if="node.status === 'reading_source'"
      class="my-2 text-sm text-muted flex items-center gap-2"
    >
      <UIcon name="i-lucide-book-open" class="animate-pulse" />
      {{ $t('webBrowsing.readingSource') }}
    </p>
    <USeparator :label="$t('webBrowsing.nodeDetails')" />
    <UAlert
      v-if="node.error"
      class="my-2"
      :title="$t('webBrowsing.nodeFailed')"
      :description="node.error"
      color="error"
      variant="soft"
      :actions="
        disabled
          ? []
          : [
              {
                label: $t('webBrowsing.retry'),
                color: 'secondary',
                onClick: () => $emit('retry', node.id),
              },
            ]
      "
    />
    <UAlert
      v-if="node.status === 'no_evidence' && node.searchAssessment"
      class="my-3"
      icon="i-lucide-file-search"
      color="neutral"
      variant="soft"
      :title="$t('searchAssessment.title')"
      :description="$t(`searchAssessment.reasons.${node.searchAssessment.reason}`)"
      :actions="
        disabled
          ? []
          : [
              {
                label: $t('webBrowsing.retry'),
                color: 'neutral',
                onClick: () => $emit('retry', node.id),
              },
            ]
      "
    >
      <template #description>
        <p>{{ $t(`searchAssessment.reasons.${node.searchAssessment.reason}`) }}</p>
        <p class="mt-2">{{
          $t('searchAssessment.counts', {
            results: node.searchAssessment.resultsCount,
            relevant: node.searchAssessment.relevantCount,
            findings: node.searchAssessment.findingsCount,
            verified: node.searchAssessment.verifiedCount,
          })
        }}</p>
        <p v-if="node.searchAssessment.extractionRetried" class="mt-2">{{
          $t('searchAssessment.extractionRetried')
        }}</p>
      </template>
    </UAlert>
    <h2 class="text-xl font-bold my-2 break-words">
      {{ node.label ?? $t('webBrowsing.generating') }}
    </h2>

    <div v-if="node.searchPlan" class="my-3 flex flex-wrap items-center gap-2 text-sm">
      <UBadge variant="soft" color="neutral">{{
        $t(`searchPlan.intent.${node.searchPlan.intent || 'general'}`)
      }}</UBadge>
      <UBadge v-if="node.searchPlan.timeRange" variant="soft" color="neutral">{{
        $t(`searchPlan.time.${node.searchPlan.timeRange}`)
      }}</UBadge>
      <span v-if="node.searchPlan.startDate || node.searchPlan.endDate"
        >{{ node.searchPlan.startDate || '…' }} — {{ node.searchPlan.endDate || '…' }}</span
      >
      <span v-if="node.searchPlan.includeDomains?.length" class="break-all">{{
        node.searchPlan.includeDomains.join(', ')
      }}</span>
      <span v-if="node.searchAttempt === 2">{{ $t('searchPlan.rewritten') }}</span>
    </div>
    <p v-if="node.searchLimitations?.length" class="my-2 text-sm text-gray-600 dark:text-gray-300">
      {{
        $t('searchPlan.limited', {
          filters: node.searchLimitations
            .map((item) => $t(`searchPlan.filters.${item}`))
            .join(', '),
        })
      }}
    </p>

    <!-- Research goal -->
    <h3 class="text-lg font-semibold mt-2">
      {{ $t('webBrowsing.researchGoal') }}
    </h3>
    <!-- Root node has no additional information -->
    <p v-if="isRootNode(node.id)">
      {{ $t('webBrowsing.startNode.description') }}
    </p>
    <p
      v-if="node.researchGoal"
      class="prose max-w-none dark:prose-invert break-words"
      v-html="renderSafeMarkdown(node.researchGoal)"
    />

    <!-- Visited URLs -->
    <h3 class="text-lg font-semibold mt-2">
      {{ $t('webBrowsing.visitedUrls') }}
    </h3>
    <ul v-if="node.searchResults?.length" class="list-disc list-inside">
      <li
        v-for="(item, index) in node.searchResults"
        class="whitespace-pre-wrap break-all"
        :key="index"
      >
        <UButton
          v-if="toSafeHttpUrl(item.url)"
          class="!p-0 contents"
          variant="link"
          :href="toSafeHttpUrl(item.url)"
          target="_blank"
          rel="noopener noreferrer"
        >
          {{ item.title || item.url }}
        </UButton>
        <span v-else>{{ item.title || item.url }}</span>
        <span v-if="item.publishedAt" class="ml-2 text-xs text-gray-600 dark:text-gray-300">{{
          $t('searchPlan.published', { date: item.publishedAt })
        }}</span>
      </li>
    </ul>
    <span v-else> - </span>

    <!-- Learnings -->
    <h3 class="text-lg font-semibold mt-2">
      {{ $t('webBrowsing.learnings') }}
    </h3>

    <ReasoningAccordion
      v-if="node.generateLearningsReasoning"
      v-model="node.generateLearningsReasoning"
      class="my-2"
      :loading="
        node.status === 'processing_search_result_reasoning' ||
        node.status === 'processing_search_result'
      "
    />
    <template v-for="({ learning }, index) in node.learnings" :key="index">
      <p
        v-if="learning"
        class="prose max-w-none dark:prose-invert break-words"
        v-html="renderSafeMarkdown(`- ${learning}`)"
      ></p>
    </template>
    <span v-if="!node.learnings?.length"> - </span>

    <!-- Follow up questions -->
    <!-- Only show if there is reasoning content. Otherwise the follow-ups are basically just child nodes. -->
    <template v-if="node.generateQueriesReasoning">
      <h3 class="text-lg font-semibold my-2">
        {{ $t('webBrowsing.followUpQuestions') }}
      </h3>

      <!-- Set loading default to true, because currently don't know how to handle it otherwise -->
      <ReasoningAccordion
        v-if="node.generateQueriesReasoning"
        v-model="node.generateQueriesReasoning"
        :loading="
          node.status === 'generating_query_reasoning' || node.status === 'generating_query'
        "
      />
    </template>
  </div>
</template>
