<script setup lang="ts">
  import type { ResearchLearning } from '~~/shared/types/research-session'
  import type { RefinementRequest, RefinementStage } from '~/utils/research-refinement'
  import { toSafeHttpUrl } from '~/utils/markdown'

  const props = defineProps<{
    learnings: ResearchLearning[]
    citedIndices: number[]
    disabled?: boolean
    pending?: boolean
    stage?: RefinementStage
    error?: string
    success?: string
  }>()
  const selectedIndex = defineModel<number>({ required: true })
  const emit = defineEmits<{
    refine: [request: RefinementRequest]
    close: []
    cancel: []
  }>()
  const { t, locale } = useI18n()
  const instruction = shallowRef('')
  const root = useTemplateRef<HTMLElement>('root')
  const learning = computed(() => props.learnings[selectedIndex.value])
  const sourceUrl = computed(() => (learning.value ? toSafeHttpUrl(learning.value.url) : undefined))
  const items = computed(() =>
    props.citedIndices.map((index) => ({
      value: index,
      label: `[${index + 1}] ${props.learnings[index]?.title || props.learnings[index]?.learning || ''}`,
    })),
  )
  const retrievedAt = computed(() => {
    const value = learning.value?.evidence?.retrievedAt
    if (!value || !Number.isFinite(Date.parse(value))) return ''
    return new Date(value).toLocaleString(locale.value)
  })
  const canSubmit = computed(
    () =>
      !props.disabled &&
      !props.pending &&
      instruction.value.trim().length > 0 &&
      instruction.value.length <= 2000 &&
      props.citedIndices.includes(selectedIndex.value),
  )
  watch(selectedIndex, () => {
    instruction.value = ''
  })

  function submit() {
    if (canSubmit.value)
      emit('refine', { learningIndex: selectedIndex.value, instruction: instruction.value.trim() })
  }
  function focus() {
    root.value?.focus()
  }
  defineExpose({ focus })
</script>

<template>
  <section
    ref="root"
    tabindex="-1"
    aria-labelledby="research-evidence-heading"
    class="my-6 rounded-lg border border-gray-300 dark:border-gray-600 p-4 sm:p-5 focus-visible:outline-2 focus-visible:outline-primary"
  >
    <div class="flex items-center justify-between gap-4 mb-4">
      <h3 id="research-evidence-heading" class="font-semibold">{{
        t('researchEvidence.title')
      }}</h3>
      <UButton
        icon="i-lucide-x"
        variant="ghost"
        color="neutral"
        :aria-label="t('researchEvidence.close')"
        @click="emit('close')"
      />
    </div>
    <UFormField :label="t('researchEvidence.finding')" class="mb-4">
      <USelect
        v-model="selectedIndex"
        :items="items"
        :disabled="pending"
        class="w-full"
        :aria-label="t('researchEvidence.finding')"
      />
    </UFormField>
    <template v-if="learning">
      <p class="font-medium leading-relaxed break-words">{{ learning.learning }}</p>
      <div class="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <UBadge variant="soft" color="neutral">{{
          t(
            learning.evidence?.sourceType === 'page'
              ? 'researchEvidence.page'
              : 'researchEvidence.searchResult',
          )
        }}</UBadge>
        <UButton
          v-if="sourceUrl"
          :href="sourceUrl"
          target="_blank"
          rel="noopener noreferrer"
          variant="link"
          icon="i-lucide-external-link"
          class="min-w-0 break-all whitespace-normal text-left"
          >{{ learning.title || learning.url }}</UButton
        >
      </div>
      <template v-if="learning.evidence">
        <p class="mt-4 mb-2 text-sm font-medium">{{ t('researchEvidence.excerpt') }}</p>
        <blockquote
          class="text-sm leading-7 whitespace-pre-wrap break-words bg-gray-50 dark:bg-gray-800 rounded-md p-4"
          >{{ learning.evidence.excerpt }}</blockquote
        >
        <p class="mt-2 text-sm text-gray-600 dark:text-gray-300">{{
          t('researchEvidence.excerptHelp')
        }}</p>
        <p v-if="retrievedAt" class="mt-1 text-xs text-gray-600 dark:text-gray-300">{{
          t('researchEvidence.retrievedAt', { date: retrievedAt })
        }}</p>
      </template>
      <p v-else class="mt-3 text-sm leading-relaxed text-gray-600 dark:text-gray-300">{{
        t('researchEvidence.missing')
      }}</p>
    </template>
    <form class="mt-6 pt-5 border-t border-gray-200 dark:border-gray-700" @submit.prevent="submit">
      <UFormField :label="t('researchEvidence.request')" :help="t('researchEvidence.scope')">
        <UTextarea
          v-model="instruction"
          :rows="3"
          :maxlength="2000"
          :disabled="disabled || pending"
          :placeholder="t('researchEvidence.placeholder')"
          :aria-label="t('researchEvidence.request')"
          class="w-full"
        />
      </UFormField>
      <div class="mt-3 flex flex-wrap items-center gap-3">
        <UButton
          type="submit"
          icon="i-lucide-search-check"
          loading-icon="i-lucide-loader-circle"
          :disabled="!canSubmit"
          :loading="pending"
          >{{
            pending ? t(`researchEvidence.${stage || 'searching'}`) : t('researchEvidence.submit')
          }}</UButton
        >
        <UButton v-if="pending" color="neutral" variant="outline" @click="emit('cancel')">{{
          t('researchEvidence.cancel')
        }}</UButton>
      </div>
    </form>
    <p v-if="pending" role="status" aria-live="polite" class="mt-3 text-sm">{{
      t(`researchEvidence.${stage || 'searching'}`)
    }}</p>
    <UAlert v-if="error" class="mt-4" color="error" variant="soft" :title="error" role="alert" />
    <UAlert
      v-if="success && !pending"
      class="mt-4"
      color="success"
      variant="soft"
      :title="success"
      role="status"
    />
  </section>
</template>
