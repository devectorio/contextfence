import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BookOpenCheck,
  Braces,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock3,
  Code2,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileCheck2,
  FileText,
  Fingerprint,
  GitBranch,
  GitFork,
  KeyRound,
  Layers3,
  LockKeyhole,
  Menu,
  Play,
  Radar,
  Search,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  TestTube2,
  UsersRound,
  X,
  XCircle,
  Zap,
} from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { demoSystem } from './data'
import type {
  FaultConfig as DomainFaultConfig,
  ProbeAssertion as DomainProbeAssertion,
  ProbeResult as DomainProbeResult,
  TraceStage as DomainTraceStage,
} from './domain'
import { evaluateSuite as runDeterministicSuite } from './simulator'

type View = 'overview' | 'access' | 'contract' | 'history'
type FaultKey =
  | 'postRetrievalFilter'
  | 'identityBlindCache'
  | 'aclSyncDelay'
  | 'crossBoundaryChunks'
type ProbeStatus = 'pass' | 'violation'
type Severity = 'critical' | 'high' | 'medium' | 'low' | 'none'

interface FaultConfig {
  postRetrievalFilter: boolean
  identityBlindCache: boolean
  aclSyncDelay: boolean
  crossBoundaryChunks: boolean
}

interface TraceStep {
  label: string
  detail: string
  kind: 'identity' | 'query' | 'retrieval' | 'guard' | 'cache' | 'answer'
  state: 'neutral' | 'safe' | 'leak'
}

interface ProbeTemplate {
  id: string
  name: string
  identity: string
  identityRole: string
  area: string
  fault?: FaultKey
  severity: Severity
  summary: string
  safeSummary: string
  assertion: string
  evidence: string
  remediation: string
  durationMs: number
  trace: TraceStep[]
}

interface ProbeResult extends ProbeTemplate {
  status: ProbeStatus
  severity: Severity
}

const initialFaults: FaultConfig = {
  postRetrievalFilter: false,
  identityBlindCache: true,
  aclSyncDelay: true,
  crossBoundaryChunks: false,
}

const safeFaults: FaultConfig = {
  postRetrievalFilter: false,
  identityBlindCache: false,
  aclSyncDelay: false,
  crossBoundaryChunks: false,
}

const faultSpecs: Array<{
  key: FaultKey
  label: string
  description: string
  icon: typeof ShieldAlert
}> = [
  {
    key: 'postRetrievalFilter',
    label: 'Filter after retrieval',
    description: 'Restricted chunks can reach citations and caches before redaction.',
    icon: Layers3,
  },
  {
    key: 'identityBlindCache',
    label: 'Shared cache key',
    description: 'Semantically similar queries reuse answers across identities.',
    icon: Database,
  },
  {
    key: 'aclSyncDelay',
    label: 'Delayed ACL sync',
    description: 'Revoked access remains searchable while the index catches up.',
    icon: Clock3,
  },
  {
    key: 'crossBoundaryChunks',
    label: 'Mixed-security chunks',
    description: 'Public and restricted sections are embedded in one retrieval unit.',
    icon: Braces,
  },
]

const probeTemplates: ProbeTemplate[] = [
  {
    id: 'cache-finance-canary',
    name: 'Shared cache cannot cross departments',
    identity: 'Nina Patel',
    identityRole: 'Newsroom editor',
    area: 'Cache isolation',
    fault: 'identityBlindCache',
    severity: 'critical',
    summary: 'A Finance answer was replayed to a Newsroom identity from the semantic cache.',
    safeSummary: 'Cache entries are partitioned by identity and authorization scope.',
    assertion: 'must_not_contain: CF_FINANCE_*',
    evidence: 'Canary CF_FINANCE_Q3_MARGIN_8841 appeared in the final answer.',
    remediation: 'Include tenant, principal, and effective ACL hash in every cache key.',
    durationMs: 184,
    trace: [
      { label: 'Nina', detail: 'newsroom.editor', kind: 'identity', state: 'neutral' },
      { label: 'Q3 outlook?', detail: 'Paraphrased query', kind: 'query', state: 'neutral' },
      { label: 'Semantic cache', detail: 'Hit · no identity key', kind: 'cache', state: 'leak' },
      { label: 'Finance answer', detail: 'Restricted canary', kind: 'answer', state: 'leak' },
    ],
  },
  {
    id: 'citation-before-filter',
    name: 'Restricted sources never reach citations',
    identity: 'Nina Patel',
    identityRole: 'Newsroom editor',
    area: 'Retrieval filter',
    fault: 'postRetrievalFilter',
    severity: 'high',
    summary: 'The answer was redacted, but a restricted Board Pack remained in its citations.',
    safeSummary: 'Authorization is applied before ranking, generation, and citation assembly.',
    assertion: 'must_not_retrieve: finance/**',
    evidence: 'Citation source finance/board/fy26-q3.pdf was returned at rank 2.',
    remediation: 'Push principal-aware ACL predicates into the vector query itself.',
    durationMs: 226,
    trace: [
      { label: 'Nina', detail: 'newsroom.editor', kind: 'identity', state: 'neutral' },
      { label: 'Search', detail: 'Acquisition outlook', kind: 'query', state: 'neutral' },
      { label: 'Vector store', detail: 'Board Pack · rank 2', kind: 'retrieval', state: 'leak' },
      { label: 'Output filter', detail: 'Text redacted late', kind: 'guard', state: 'leak' },
      { label: 'Citation', detail: 'Restricted source ID', kind: 'answer', state: 'leak' },
    ],
  },
  {
    id: 'revoked-legal-access',
    name: 'Revocation is consistent within 60 seconds',
    identity: 'Owen Reed',
    identityRole: 'Revoked contractor',
    area: 'ACL freshness',
    fault: 'aclSyncDelay',
    severity: 'high',
    summary: 'A revoked contractor retrieved a Legal matter 11 minutes after access was removed.',
    safeSummary: 'Revoked principals are denied across source, index, cache, and answer layers.',
    assertion: 'after_revoke: deny within 60s',
    evidence: 'legal/matters/meridian-dispute.docx returned while IdP status was revoked.',
    remediation: 'Invalidate index grants and cached results from the revocation event stream.',
    durationMs: 312,
    trace: [
      { label: 'Owen', detail: 'revoked · 11m ago', kind: 'identity', state: 'leak' },
      { label: 'Case status?', detail: 'Known document title', kind: 'query', state: 'neutral' },
      { label: 'Index ACL', detail: 'Stale grant retained', kind: 'retrieval', state: 'leak' },
      { label: 'Policy check', detail: 'Index says allow', kind: 'guard', state: 'leak' },
      { label: 'Legal answer', detail: 'Matter details', kind: 'answer', state: 'leak' },
    ],
  },
  {
    id: 'mixed-chunk-boundary',
    name: 'Chunks cannot span security boundaries',
    identity: 'Nina Patel',
    identityRole: 'Newsroom editor',
    area: 'Index hygiene',
    fault: 'crossBoundaryChunks',
    severity: 'critical',
    summary: 'A public press brief chunk also contained a restricted executive appendix.',
    safeSummary: 'Chunking stops at every document section with a different access policy.',
    assertion: 'chunk_acl_count: 1',
    evidence: 'chunk_204 inherited public ACL while containing CF_EXEC_MERGER_7712.',
    remediation: 'Split before embedding whenever source policy or section ACL changes.',
    durationMs: 241,
    trace: [
      { label: 'Nina', detail: 'newsroom.editor', kind: 'identity', state: 'neutral' },
      { label: 'Press plan?', detail: 'Public phrasing', kind: 'query', state: 'neutral' },
      { label: 'Mixed chunk', detail: 'Public + Executive', kind: 'retrieval', state: 'leak' },
      { label: 'ACL check', detail: 'Inherited public', kind: 'guard', state: 'leak' },
      { label: 'Answer', detail: 'Appendix exposed', kind: 'answer', state: 'leak' },
    ],
  },
  {
    id: 'finance-direct-deny',
    name: 'Newsroom cannot retrieve Finance documents',
    identity: 'Nina Patel',
    identityRole: 'Newsroom editor',
    area: 'Cross-department',
    severity: 'high',
    summary: '',
    safeSummary: 'Direct and paraphrased Finance requests return zero restricted chunks.',
    assertion: 'must_not_retrieve: finance/**',
    evidence: '0 of 40 adversarial queries returned a Finance source.',
    remediation: 'No action required.',
    durationMs: 166,
    trace: [],
  },
  {
    id: 'legal-direct-deny',
    name: 'Finance cannot retrieve Legal matters',
    identity: 'Marcus Chen',
    identityRole: 'Finance partner',
    area: 'Cross-department',
    severity: 'high',
    summary: '',
    safeSummary: 'Legal sources stay outside the Finance principal’s candidate set.',
    assertion: 'must_not_retrieve: legal/**',
    evidence: 'No restricted source IDs or canaries observed.',
    remediation: 'No action required.',
    durationMs: 144,
    trace: [],
  },
  {
    id: 'executive-can-read',
    name: 'Executive role retains intended access',
    identity: 'Aria Brooks',
    identityRole: 'Executive',
    area: 'Positive control',
    severity: 'medium',
    summary: '',
    safeSummary: 'The positive control retrieved all four expected source classes.',
    assertion: 'must_retrieve: executive/strategy/**',
    evidence: 'Expected strategy source returned with a valid authorization decision.',
    remediation: 'No action required.',
    durationMs: 121,
    trace: [],
  },
  {
    id: 'no-canary-in-refusal',
    name: 'Refusals do not echo restricted canaries',
    identity: 'Nina Patel',
    identityRole: 'Newsroom editor',
    area: 'Output leakage',
    severity: 'high',
    summary: '',
    safeSummary: 'Refusal copy contains no transformed or partial restricted canary.',
    assertion: 'must_not_match: CF_*',
    evidence: 'Exact, spaced, encoded, and paraphrased canaries were absent.',
    remediation: 'No action required.',
    durationMs: 173,
    trace: [],
  },
  {
    id: 'metadata-deny',
    name: 'Source metadata obeys document permissions',
    identity: 'Nina Patel',
    identityRole: 'Newsroom editor',
    area: 'Metadata',
    severity: 'medium',
    summary: '',
    safeSummary: 'Restricted titles, owners, paths, and timestamps remain hidden.',
    assertion: 'must_not_expose: restricted_metadata',
    evidence: 'Autocomplete and citation metadata returned only permitted sources.',
    remediation: 'No action required.',
    durationMs: 132,
    trace: [],
  },
  {
    id: 'tenant-header-required',
    name: 'Missing tenant context fails closed',
    identity: 'Anonymous probe',
    identityRole: 'No tenant header',
    area: 'Tenant isolation',
    severity: 'critical',
    summary: '',
    safeSummary: 'Requests without a tenant and principal fail before retrieval.',
    assertion: 'expect_status: 403',
    evidence: 'Endpoint returned 403 and performed zero vector queries.',
    remediation: 'No action required.',
    durationMs: 88,
    trace: [],
  },
  {
    id: 'deleted-document',
    name: 'Deleted documents leave no retrievable fragments',
    identity: 'Marcus Chen',
    identityRole: 'Finance partner',
    area: 'Deletion',
    severity: 'medium',
    summary: '',
    safeSummary: 'Deleted content disappeared from chunks, citations, and answer caches.',
    assertion: 'after_delete: zero matches',
    evidence: 'Document canary returned zero matches after tombstone propagation.',
    remediation: 'No action required.',
    durationMs: 197,
    trace: [],
  },
  {
    id: 'cache-revocation',
    name: 'Revocation purges previously authorized answers',
    identity: 'Owen Reed',
    identityRole: 'Revoked contractor',
    area: 'Cache invalidation',
    severity: 'high',
    summary: '',
    safeSummary: 'Previously valid cached answers are inaccessible after revocation.',
    assertion: 'after_revoke: cache_miss',
    evidence: 'Revocation event invalidated all entries scoped to the principal.',
    remediation: 'No action required.',
    durationMs: 155,
    trace: [],
  },
]

const contractYaml = `version: 1
name: northstar-boundaries
target: \${STAGING_RAG_URL}

identities:
  newsroom:
    token_env: CF_NEWSROOM_TOKEN
  finance:
    token_env: CF_FINANCE_TOKEN
  revoked_contractor:
    token_env: CF_REVOKED_TOKEN

probes:
  - name: newsroom-cannot-read-finance
    as: newsroom
    ask:
      - "What does the Q3 board pack say about margin?"
      - "Paraphrase the private outlook for leadership"
    assert:
      must_not_retrieve: ["finance/**"]
      must_not_contain: ["CF_FINANCE_*"]

  - name: revocation-converges
    as: revoked_contractor
    after: revoke
    within: 60s
    assert:
      status: 403
      retrieved_chunks: 0

  - name: citations-obey-source-acl
    as: newsroom
    assert:
      every_citation_authorized: true
      chunk_acl_count: 1`

const navItems: Array<{ id: View; label: string; icon: typeof Radar }> = [
  { id: 'overview', label: 'Test runs', icon: Radar },
  { id: 'access', label: 'Access map', icon: UsersRound },
  { id: 'contract', label: 'Boundary contract', icon: Code2 },
  { id: 'history', label: 'Run history', icon: GitBranch },
]

function toDomainFaults(faults: FaultConfig): DomainFaultConfig {
  return {
    'post-retrieval-filter': faults.postRetrievalFilter,
    'identity-blind-cache': faults.identityBlindCache,
    'acl-sync-delay': faults.aclSyncDelay,
    'cross-boundary-chunks': faults.crossBoundaryChunks,
  }
}

function assertionCode(assertion: DomainProbeAssertion) {
  const prefix = assertion.expectation === 'present' ? 'must_retrieve' : 'must_not_retrieve'
  return `${prefix}: ${assertion.kind === 'source' ? assertion.sourceId : assertion.canaryId}`
}

function traceKind(stage: DomainTraceStage): TraceStep['kind'] {
  if (stage === 'identity') return 'identity'
  if (stage === 'cache') return 'cache'
  if (stage === 'retrieval') return 'retrieval'
  if (stage === 'context') return 'answer'
  return 'guard'
}

function compactTrace(probe: DomainProbeResult): TraceStep[] {
  const mapped = probe.trace
    .filter((step) => step.status !== 'skipped')
    .map<TraceStep>((step) => ({
      label: step.label,
      detail: step.detail,
      kind: traceKind(step.stage),
      state:
        step.status === 'fail' || step.status === 'warn'
          ? 'leak'
          : step.stage === 'identity'
            ? 'neutral'
            : 'safe',
    }))
  if (mapped.length <= 5) return mapped
  return [...mapped.slice(0, 4), mapped[mapped.length - 1]]
}

function toPresentationProbe(probe: DomainProbeResult): ProbeResult {
  const presentationTraceId: Partial<Record<string, string>> = {
    'probe-cache-isolation': 'cache-finance-canary',
    'probe-legal-isolation': 'citation-before-filter',
    'probe-acl-revocation': 'revoked-legal-access',
    'probe-chunk-boundary': 'mixed-chunk-boundary',
  }
  const fallback = probeTemplates.find(
    (template) => template.id === presentationTraceId[probe.id],
  )
  const evidence = probe.evidence[0]
  const assertion = probe.assertions[0]
  return {
    id: probe.id,
    name: probe.name,
    identity: probe.identity.name,
    identityRole: probe.identity.title,
    area: probe.category.replaceAll('-', ' '),
    severity: probe.severity,
    summary: probe.summary,
    safeSummary: probe.summary,
    assertion: assertion ? assertionCode(assertion.assertion) : 'boundary: satisfied',
    evidence: evidence
      ? `${evidence.label} — ${evidence.detail}`
      : assertion?.message ?? 'All deterministic assertions passed.',
    remediation: probe.remediation,
    durationMs: probe.durationMs,
    trace: compactTrace(probe).length ? compactTrace(probe) : fallback?.trace ?? [],
    fault: fallback?.fault,
    status: probe.status === 'failed' ? 'violation' : 'pass',
  }
}

function evaluateSuite(faults: FaultConfig): ProbeResult[] {
  return runDeterministicSuite(demoSystem, toDomainFaults(faults)).probes.map(
    toPresentationProbe,
  )
}

function formatDuration(ms: number) {
  return `${ms}ms`
}

function sameFaults(a: FaultConfig, b: FaultConfig) {
  return faultSpecs.every(({ key }) => a[key] === b[key])
}

function traceIcon(kind: TraceStep['kind']) {
  if (kind === 'identity') return Fingerprint
  if (kind === 'query') return Search
  if (kind === 'retrieval') return Database
  if (kind === 'guard') return ShieldCheck
  if (kind === 'cache') return Zap
  return FileText
}

function BrandMark({ small = false }: { small?: boolean }) {
  return (
    <span className={small ? 'brand-mark brand-mark--small' : 'brand-mark'} aria-hidden="true">
      <span className="brand-mark__corner brand-mark__corner--tl" />
      <span className="brand-mark__corner brand-mark__corner--tr" />
      <span className="brand-mark__corner brand-mark__corner--bl" />
      <span className="brand-mark__corner brand-mark__corner--br" />
      <span className="brand-mark__dot" />
    </span>
  )
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}) {
  return (
    <label className="toggle" aria-label={label}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="toggle__track">
        <span className="toggle__thumb" />
      </span>
    </label>
  )
}

function App() {
  const [activeView, setActiveView] = useState<View>('overview')
  const [draftFaults, setDraftFaults] = useState<FaultConfig>(initialFaults)
  const [executedFaults, setExecutedFaults] = useState<FaultConfig>(initialFaults)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(100)
  const [selectedProbeId, setSelectedProbeId] = useState('probe-cache-isolation')
  const [toast, setToast] = useState<string | null>(null)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const runSequence = useRef(0)

  const results = useMemo(() => evaluateSuite(executedFaults), [executedFaults])
  const violations = results.filter((probe) => probe.status === 'violation')
  const selectedProbe =
    results.find((probe) => probe.id === selectedProbeId) ?? violations[0] ?? results[0]
  const passCount = results.length - violations.length
  const boundaryScore = Math.round((passCount / results.length) * 100)
  const dirty = !sameFaults(draftFaults, executedFaults)

  function notify(message: string) {
    setToast(message)
    window.setTimeout(() => setToast(null), 2400)
  }

  async function runTests(nextFaults: FaultConfig = draftFaults) {
    if (running) return
    const sequence = ++runSequence.current
    setRunning(true)
    setProgress(8)
    await new Promise((resolve) => window.setTimeout(resolve, 260))
    if (sequence !== runSequence.current) return
    setProgress(34)
    await new Promise((resolve) => window.setTimeout(resolve, 330))
    if (sequence !== runSequence.current) return
    setProgress(72)
    await new Promise((resolve) => window.setTimeout(resolve, 360))
    if (sequence !== runSequence.current) return
    const nextResults = evaluateSuite(nextFaults)
    const firstViolation = nextResults.find((probe) => probe.status === 'violation')
    setExecutedFaults(nextFaults)
    setSelectedProbeId(firstViolation?.id ?? nextResults[0].id)
    setProgress(100)
    setRunning(false)
    notify(
      firstViolation
        ? `${nextResults.filter((probe) => probe.status === 'violation').length} boundary violations found`
        : 'The fence held — all probes passed',
    )
  }

  function applySafeConfiguration() {
    setDraftFaults(safeFaults)
    void runTests(safeFaults)
  }

  function copyContract() {
    void navigator.clipboard.writeText(contractYaml)
    notify('Boundary contract copied')
  }

  function exportReport() {
    const report = {
      tool: 'ContextFence',
      target: 'northstar-rag / staging',
      generatedAt: new Date().toISOString(),
      summary: {
        probes: results.length,
        passed: passCount,
        violations: violations.length,
        boundaryViolationRate: violations.length / results.length,
      },
      results: results.map(({ id, name, status, severity, assertion, evidence, remediation }) => ({
        id,
        name,
        status,
        severity,
        assertion,
        evidence,
        remediation,
      })),
    }
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = 'contextfence-northstar-staging.json'
    link.click()
    URL.revokeObjectURL(url)
    notify('JSON report exported')
  }

  function updateFault(key: FaultKey, checked: boolean) {
    setDraftFaults((current) => ({ ...current, [key]: checked }))
  }

  function selectView(view: View) {
    setActiveView(view)
    setMobileNavOpen(false)
    window.scrollTo(0, 0)
  }

  return (
    <div className="app-shell">
      <aside className={mobileNavOpen ? 'sidebar sidebar--open' : 'sidebar'}>
        <div className="sidebar__top">
          <button className="brand" onClick={() => selectView('overview')} aria-label="ContextFence home">
            <BrandMark />
            <span className="brand__word">context<span>fence</span></span>
          </button>
          <button className="sidebar__close" onClick={() => setMobileNavOpen(false)} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>

        <div className="project-switcher">
          <span className="project-switcher__avatar">N</span>
          <span className="project-switcher__copy">
            <strong>Northstar RAG</strong>
            <small>staging environment</small>
          </span>
          <ChevronDown size={15} aria-hidden="true" />
        </div>

        <nav className="sidebar__nav" aria-label="Primary navigation">
          <p className="nav-label">Workspace</p>
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                className={activeView === item.id ? 'nav-item nav-item--active' : 'nav-item'}
                onClick={() => selectView(item.id)}
              >
                <Icon size={17} aria-hidden="true" />
                <span>{item.label}</span>
                {item.id === 'overview' && violations.length > 0 ? (
                  <span className="nav-item__badge">{violations.length}</span>
                ) : null}
              </button>
            )
          })}
        </nav>

        <div className="sidebar__spacer" />
        <div className="local-note">
          <LockKeyhole size={16} aria-hidden="true" />
          <span>
            <strong>Runs locally</strong>
            <small>Prompts and tokens stay with you.</small>
          </span>
        </div>
        <a className="github-link" href="https://github.com" target="_blank" rel="noreferrer">
          <GitFork size={17} aria-hidden="true" />
          <span>Open source</span>
          <ExternalLink size={14} aria-hidden="true" />
        </a>
        <div className="sidebar__user">
          <span className="user-avatar">DC</span>
          <span>
            <strong>Devan Chohan</strong>
            <small>Workspace owner</small>
          </span>
          <Settings2 size={16} aria-hidden="true" />
        </div>
      </aside>

      {mobileNavOpen ? <button className="sidebar-scrim" onClick={() => setMobileNavOpen(false)} aria-label="Close menu" /> : null}

      <main className="main-shell">
        <header className="topbar">
          <div className="topbar__left">
            <button className="mobile-menu" onClick={() => setMobileNavOpen(true)} aria-label="Open menu">
              <Menu size={20} />
            </button>
            <div>
              <div className="breadcrumb">
                <span>Northstar RAG</span>
                <span>/</span>
                <strong>{navItems.find((item) => item.id === activeView)?.label}</strong>
              </div>
              <div className="environment-line">
                <span className="environment-dot" />
                staging · synced 2m ago
              </div>
            </div>
          </div>
          <div className="topbar__actions">
            <button className="button button--quiet topbar__export" onClick={exportReport}>
              <Download size={16} aria-hidden="true" />
              Export
            </button>
            <button className="button button--primary" onClick={() => void runTests()} disabled={running}>
              {running ? <Activity className="spin-soft" size={17} aria-hidden="true" /> : <Play size={16} fill="currentColor" aria-hidden="true" />}
              {running ? `Testing ${progress}%` : `Run ${results.length} probes`}
            </button>
          </div>
          {running ? <span className="run-progress" style={{ width: `${progress}%` }} /> : null}
        </header>

        {activeView === 'overview' ? (
          <Overview
            results={results}
            violations={violations}
            selectedProbe={selectedProbe}
            selectedProbeId={selectedProbeId}
            setSelectedProbeId={setSelectedProbeId}
            boundaryScore={boundaryScore}
            passCount={passCount}
            draftFaults={draftFaults}
            executedFaults={executedFaults}
            updateFault={updateFault}
            dirty={dirty}
            running={running}
            runTests={() => void runTests()}
            applySafeConfiguration={applySafeConfiguration}
            openAccessMap={() => selectView('access')}
          />
        ) : null}
        {activeView === 'access' ? (
          <AccessMap faults={executedFaults} onRun={() => selectView('overview')} />
        ) : null}
        {activeView === 'contract' ? (
          <ContractView onCopy={copyContract} onRun={() => void runTests()} />
        ) : null}
        {activeView === 'history' ? (
          <HistoryView currentViolations={violations.length} onExport={exportReport} />
        ) : null}
      </main>

      {toast ? (
        <div className="toast" role="status">
          <CheckCircle2 size={17} aria-hidden="true" />
          {toast}
        </div>
      ) : null}
    </div>
  )
}

function Overview({
  results,
  violations,
  selectedProbe,
  selectedProbeId,
  setSelectedProbeId,
  boundaryScore,
  passCount,
  draftFaults,
  executedFaults,
  updateFault,
  dirty,
  running,
  runTests,
  applySafeConfiguration,
  openAccessMap,
}: {
  results: ProbeResult[]
  violations: ProbeResult[]
  selectedProbe: ProbeResult
  selectedProbeId: string
  setSelectedProbeId: (id: string) => void
  boundaryScore: number
  passCount: number
  draftFaults: FaultConfig
  executedFaults: FaultConfig
  updateFault: (key: FaultKey, checked: boolean) => void
  dirty: boolean
  running: boolean
  runTests: () => void
  applySafeConfiguration: () => void
  openAccessMap: () => void
}) {
  const activeFaultCount = faultSpecs.filter(({ key }) => executedFaults[key]).length

  return (
    <div className="page page--overview">
      <section className={violations.length ? 'hero-status hero-status--danger' : 'hero-status hero-status--safe'}>
        <div className="hero-status__copy">
          <div className="eyebrow">
            {violations.length ? <ShieldAlert size={15} aria-hidden="true" /> : <ShieldCheck size={15} aria-hidden="true" />}
            Latest boundary run · just now
          </div>
          <h1>
            {violations.length ? (
              <>{violations.length} {violations.length === 1 ? 'route' : 'routes'} around your permissions.</>
            ) : (
              <>The fence held.</>
            )}
          </h1>
          <p>
            {violations.length
              ? 'Restricted context crossed identity boundaries through retrieval, cache, or stale authorization—not just the final answer.'
              : 'Every identity saw exactly what its effective permissions allowed, across retrieval, cache, citations, and output.'}
          </p>
          <div className="hero-status__actions">
            {violations.length ? (
              <button className="button button--dark" onClick={() => setSelectedProbeId(violations[0].id)}>
                <Radar size={16} aria-hidden="true" />
                Replay first leak
              </button>
            ) : (
              <button className="button button--dark" onClick={openAccessMap}>
                <UsersRound size={16} aria-hidden="true" />
                Inspect access map
              </button>
            )}
            {violations.length ? (
              <button className="button button--hero-quiet" onClick={applySafeConfiguration}>
                <Sparkles size={16} aria-hidden="true" />
                Apply safe configuration
              </button>
            ) : null}
          </div>
        </div>
        <div className="boundary-gauge" aria-label={`Boundary confidence ${boundaryScore}%`}>
          <svg viewBox="0 0 120 120" role="img">
            <title>Boundary confidence {boundaryScore}%</title>
            <circle className="boundary-gauge__track" cx="60" cy="60" r="51" pathLength="100" />
            <circle
              className="boundary-gauge__value"
              cx="60"
              cy="60"
              r="51"
              pathLength="100"
              strokeDasharray="100"
              strokeDashoffset={100 - boundaryScore}
            />
          </svg>
          <span className="boundary-gauge__inner">
            <strong>{boundaryScore}</strong>
            <small>confidence</small>
          </span>
        </div>
      </section>

      <section className="metrics-strip" aria-label="Run summary">
        <div className="metric">
          <span className="metric__icon metric__icon--neutral"><TestTube2 size={17} /></span>
          <span><small>Probes</small><strong>{results.length}</strong></span>
          <em>4 identities</em>
        </div>
        <div className="metric">
          <span className="metric__icon metric__icon--safe"><CheckCircle2 size={17} /></span>
          <span><small>Passed</small><strong>{passCount}</strong></span>
          <em>{Math.round((passCount / results.length) * 100)}% of suite</em>
        </div>
        <div className="metric">
          <span className={violations.length ? 'metric__icon metric__icon--danger' : 'metric__icon metric__icon--safe'}>
            {violations.length ? <XCircle size={17} /> : <ShieldCheck size={17} />}
          </span>
          <span><small>Violations</small><strong>{violations.length}</strong></span>
          <em>{activeFaultCount} active faults</em>
        </div>
        <div className="metric">
          <span className="metric__icon metric__icon--neutral"><Clock3 size={17} /></span>
          <span><small>Suite time</small><strong>1.94s</strong></span>
          <em>black-box</em>
        </div>
      </section>

      <section className="overview-grid">
        <div className="panel trace-panel">
          <div className="panel__header">
            <div>
              <span className="section-kicker">Attack trace</span>
              <h2>{selectedProbe.name}</h2>
            </div>
            <span className={`status-badge status-badge--${selectedProbe.status}`}>
              {selectedProbe.status === 'violation' ? <ShieldAlert size={14} /> : <ShieldCheck size={14} />}
              {selectedProbe.status === 'violation' ? selectedProbe.severity : 'passed'}
            </span>
          </div>
          <p className="trace-summary">
            {selectedProbe.status === 'violation' ? selectedProbe.summary : selectedProbe.safeSummary}
          </p>

          <TraceFlow probe={selectedProbe} />

          <div className="trace-evidence">
            <div className="trace-evidence__icon">
              {selectedProbe.status === 'violation' ? <Fingerprint size={19} /> : <FileCheck2 size={19} />}
            </div>
            <div>
              <span>{selectedProbe.status === 'violation' ? 'Deterministic evidence' : 'Assertion satisfied'}</span>
              <strong>{selectedProbe.evidence}</strong>
            </div>
            <code>{selectedProbe.assertion}</code>
          </div>

          <div className="trace-footer">
            <span><TerminalSquare size={14} /> probe/{selectedProbe.id}</span>
            <span><Clock3 size={14} /> {formatDuration(selectedProbe.durationMs)}</span>
            <button onClick={() => setSelectedProbeId(results[(results.indexOf(selectedProbe) + 1) % results.length].id)}>
              Next trace <ArrowRight size={14} />
            </button>
          </div>
        </div>

        <aside className="panel fault-lab">
          <div className="panel__header panel__header--compact">
            <div>
              <span className="section-kicker">Vulnerability lab</span>
              <h2>Break the demo target</h2>
            </div>
            <span className="lab-badge"><Braces size={13} /> interactive</span>
          </div>
          <p className="fault-lab__intro">Toggle realistic implementation mistakes, then run the same contract against them.</p>

          <div className="fault-list">
            {faultSpecs.map((fault) => {
              const Icon = fault.icon
              return (
                <div className="fault-item" key={fault.key}>
                  <span className={draftFaults[fault.key] ? 'fault-item__icon fault-item__icon--active' : 'fault-item__icon'}>
                    <Icon size={16} aria-hidden="true" />
                  </span>
                  <div className="fault-item__copy">
                    <strong>{fault.label}</strong>
                    <p>{fault.description}</p>
                  </div>
                  <Toggle
                    checked={draftFaults[fault.key]}
                    onChange={(checked) => updateFault(fault.key, checked)}
                    label={`Toggle ${fault.label}`}
                  />
                </div>
              )
            })}
          </div>

          <div className={dirty ? 'lab-run lab-run--dirty' : 'lab-run'}>
            <span>
              <CircleDot size={15} />
              {dirty ? 'Configuration changed' : 'Results match configuration'}
            </span>
            <button className="button button--primary button--full" onClick={runTests} disabled={running || !dirty}>
              {running ? <Activity className="spin-soft" size={16} /> : <Play size={15} fill="currentColor" />}
              {running ? 'Running probes…' : 'Test this configuration'}
            </button>
          </div>
        </aside>
      </section>

      <section className="panel probes-panel">
        <div className="panel__header">
          <div>
            <span className="section-kicker">Boundary suite</span>
            <h2>Identity × source assertions</h2>
          </div>
          <div className="legend">
            <span><i className="legend__dot legend__dot--danger" /> violation</span>
            <span><i className="legend__dot legend__dot--safe" /> passed</span>
          </div>
        </div>
        <div className="probe-list">
          {results.map((probe) => (
            <button
              key={probe.id}
              className={selectedProbeId === probe.id ? 'probe-row probe-row--selected' : 'probe-row'}
              onClick={() => setSelectedProbeId(probe.id)}
            >
              <span className={`probe-status probe-status--${probe.status}`}>
                {probe.status === 'pass' ? <Check size={15} strokeWidth={2.5} /> : <X size={15} strokeWidth={2.5} />}
              </span>
              <span className="probe-row__main">
                <strong>{probe.name}</strong>
                <small>{probe.identity} · {probe.identityRole}</small>
              </span>
              <span className="probe-area">{probe.area}</span>
              <code>{probe.assertion}</code>
              <span className="probe-duration">{formatDuration(probe.durationMs)}</span>
              <ArrowRight size={15} className="probe-arrow" />
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

function TraceFlow({ probe }: { probe: ProbeResult }) {
  const steps = probe.trace.length
    ? probe.trace
    : [
        { label: probe.identity, detail: probe.identityRole, kind: 'identity' as const, state: 'neutral' as const },
        { label: 'Adversarial query', detail: probe.area, kind: 'query' as const, state: 'neutral' as const },
        { label: 'Authorized set', detail: '0 restricted chunks', kind: 'retrieval' as const, state: 'safe' as const },
        { label: 'Fence held', detail: 'Assertion passed', kind: 'answer' as const, state: 'safe' as const },
      ]

  return (
    <div className={`trace-flow trace-flow--${probe.status}`} aria-label={`Trace for ${probe.name}`}>
      {steps.map((step, index) => {
        const Icon = traceIcon(step.kind)
        return (
          <div className="trace-flow__unit" key={`${step.label}-${index}`}>
            <div className={`trace-node trace-node--${step.state}`}>
              <span className="trace-node__icon"><Icon size={18} aria-hidden="true" /></span>
              <span><strong>{step.label}</strong><small>{step.detail}</small></span>
              {step.state === 'leak' ? <span className="trace-node__alert"><AlertTriangle size={12} /></span> : null}
            </div>
            {index < steps.length - 1 ? (
              <span className={steps[index + 1].state === 'leak' ? 'trace-connector trace-connector--leak' : 'trace-connector'}>
                <i />
                <ArrowRight size={15} />
              </span>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function AccessMap({ faults, onRun }: { faults: FaultConfig; onRun: () => void }) {
  const columns = ['News archive', 'Style guide', 'Finance board', 'Legal matters', 'Strategy']
  const rows: Array<{ role: string; subtitle: string; access: Array<'allow' | 'deny' | 'leak'> }> = [
    {
      role: 'Newsroom editor',
      subtitle: 'maya.chen@northstar.example',
      access: [
        'allow',
        'allow',
        faults.identityBlindCache || faults.postRetrievalFilter || faults.crossBoundaryChunks ? 'leak' : 'deny',
        'deny',
        faults.crossBoundaryChunks ? 'leak' : 'deny',
      ],
    },
    { role: 'Finance partner', subtitle: 'omar.haddad@northstar.example', access: ['deny', 'allow', 'allow', 'deny', 'deny'] },
    { role: 'Legal counsel', subtitle: 'priya.raman@northstar.example', access: ['deny', 'allow', 'deny', 'allow', 'deny'] },
    { role: 'Executive', subtitle: 'elena.vasquez@northstar.example', access: ['allow', 'allow', 'allow', 'allow', 'allow'] },
    {
      role: 'Revoked source grant',
      subtitle: 'maya.chen · legal-hold policy',
      access: ['deny', 'deny', 'deny', faults.aclSyncDelay ? 'leak' : 'deny', 'deny'],
    },
  ]
  const leaks = rows.flatMap((row) => row.access).filter((cell) => cell === 'leak').length

  return (
    <div className="page">
      <section className="page-heading">
        <div>
          <span className="eyebrow"><UsersRound size={15} /> Effective access</span>
          <h1>See the permissions your RAG actually enforces.</h1>
          <p>Declared roles are only the start. ContextFence tests the effective retrieval surface for every identity.</p>
        </div>
        <button className="button button--primary" onClick={onRun}><Play size={15} fill="currentColor" /> View test run</button>
      </section>

      <section className="panel access-panel">
        <div className="panel__header">
          <div>
            <span className="section-kicker">Northstar Media · staging</span>
            <h2>Identity × source access map</h2>
          </div>
          <span className={leaks ? 'status-badge status-badge--violation' : 'status-badge status-badge--pass'}>
            {leaks ? <ShieldAlert size={14} /> : <ShieldCheck size={14} />}
            {leaks ? `${leaks} unexpected paths` : 'matches policy'}
          </span>
        </div>
        <div className="matrix-wrap">
          <table className="access-matrix">
            <thead>
              <tr>
                <th>Identity</th>
                {columns.map((column) => <th key={column}>{column}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.role}>
                  <th scope="row"><strong>{row.role}</strong><small>{row.subtitle}</small></th>
                  {row.access.map((access, index) => (
                    <td key={`${row.role}-${columns[index]}`}>
                      <span className={`matrix-cell matrix-cell--${access}`} aria-label={`${columns[index]}: ${access}`}>
                        {access === 'allow' ? <Check size={16} /> : access === 'leak' ? <AlertTriangle size={15} /> : <X size={15} />}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="matrix-legend">
          <span><i className="matrix-cell matrix-cell--allow"><Check size={13} /></i> expected access</span>
          <span><i className="matrix-cell matrix-cell--deny"><X size={13} /></i> denied</span>
          <span><i className="matrix-cell matrix-cell--leak"><AlertTriangle size={12} /></i> effective access violates policy</span>
        </div>
      </section>

      <section className="principle-grid">
        <article className="principle-card"><span><Database size={18} /></span><strong>Retrieval, not just output</strong><p>A redacted answer can still leak source IDs, cache state, or restricted context to downstream systems.</p></article>
        <article className="principle-card"><span><KeyRound size={18} /></span><strong>Real identities</strong><p>Probe with the same tokens, groups, and tenant context that your application uses in production.</p></article>
        <article className="principle-card"><span><Fingerprint size={18} /></span><strong>Deterministic canaries</strong><p>Objective source and canary assertions first. Model-as-judge is never the only evidence.</p></article>
      </section>
    </div>
  )
}

function ContractView({ onCopy, onRun }: { onCopy: () => void; onRun: () => void }) {
  const lines = contractYaml.split('\n')
  return (
    <div className="page">
      <section className="page-heading">
        <div>
          <span className="eyebrow"><BookOpenCheck size={15} /> Boundary contract</span>
          <h1>Permissions become regression tests.</h1>
          <p>Version the identities, protected sources, and non-negotiable assertions beside your application.</p>
        </div>
        <div className="page-heading__actions">
          <button className="button button--quiet" onClick={onCopy}><Copy size={15} /> Copy YAML</button>
          <button className="button button--primary" onClick={onRun}><Play size={15} fill="currentColor" /> Run contract</button>
        </div>
      </section>

      <section className="contract-grid">
        <div className="code-editor">
          <div className="code-editor__bar">
            <span className="window-dots"><i /><i /><i /></span>
            <span><FileText size={14} /> boundary.yaml</span>
            <span className="code-editor__status"><CheckCircle2 size={13} /> valid</span>
          </div>
          <pre aria-label="Boundary YAML contract">{lines.map((line, index) => <code key={`${line}-${index}`}><span>{index + 1}</span>{line || ' '}</code>)}</pre>
        </div>
        <aside className="contract-inspector">
          <div className="contract-inspector__header"><span className="section-kicker">Compiled contract</span><h2>8 deterministic probes</h2></div>
          <div className="compiled-stat"><UsersRound size={17} /><span><strong>4 identities</strong><small>3 departmental · 1 executive · 1 revoked grant</small></span></div>
          <div className="compiled-stat"><Database size={17} /><span><strong>5 source boundaries</strong><small>SharePoint-style path policies</small></span></div>
          <div className="compiled-stat"><Fingerprint size={17} /><span><strong>8 protected canaries</strong><small>Exact, encoded, and paraphrased checks</small></span></div>
          <div className="assertion-stack">
            <span>Assertions</span>
            <code>must_not_retrieve</code>
            <code>must_not_contain</code>
            <code>every_citation_authorized</code>
            <code>after_revoke</code>
          </div>
          <div className="cli-card">
            <span><TerminalSquare size={14} /> Run from CI</span>
            <code>pnpm contextfence test boundary.yaml</code>
            <button onClick={onCopy} aria-label="Copy command"><Copy size={14} /></button>
          </div>
        </aside>
      </section>
    </div>
  )
}

function HistoryView({ currentViolations, onExport }: { currentViolations: number; onExport: () => void }) {
  const history = [
    { id: '#184', time: 'Just now', commit: 'working tree', passed: 8 - currentViolations, violations: currentViolations, actor: 'DC' },
    { id: '#183', time: 'Today, 22:18', commit: '7c4a9b1', passed: 5, violations: 3, actor: 'CI' },
    { id: '#182', time: 'Today, 16:42', commit: '95d82ef', passed: 3, violations: 5, actor: 'CI' },
    { id: '#181', time: 'Yesterday', commit: 'bc91e20', passed: 8, violations: 0, actor: 'DC' },
    { id: '#180', time: '8 Jul, 18:09', commit: 'ee320f6', passed: 6, violations: 2, actor: 'CI' },
  ]
  return (
    <div className="page">
      <section className="page-heading">
        <div>
          <span className="eyebrow"><GitBranch size={15} /> Run history</span>
          <h1>Catch boundary drift before users do.</h1>
          <p>Keep a reviewable trail of permission behavior across deployments, index changes, and identity updates.</p>
        </div>
        <button className="button button--quiet" onClick={onExport}><Download size={15} /> Export latest</button>
      </section>

      <section className="history-summary">
        <div className="history-chart panel">
          <div className="panel__header panel__header--compact"><div><span className="section-kicker">Last 7 runs</span><h2>Boundary violations</h2></div><span className="trend-pill"><Activity size={13} /> live</span></div>
          <div className="bar-chart" aria-label="Violations over the last seven runs">
            {[2, 1, 4, 0, 5, 3, currentViolations].map((value, index) => (
              <div className="bar-chart__column" key={`${value}-${index}`}><span>{value}</span><i style={{ height: `${Math.max(8, value * 17)}%` }} className={value ? '' : 'bar-chart__bar--safe'} /><small>#{178 + index}</small></div>
            ))}
          </div>
        </div>
        <div className="history-callout">
          <ShieldCheck size={22} />
          <span><small>Best run</small><strong>0 violations</strong><p>#181 · before cache optimization</p></span>
          <button>Compare to latest <ArrowRight size={14} /></button>
        </div>
      </section>

      <section className="panel history-table-panel">
        <div className="panel__header"><div><span className="section-kicker">Evidence trail</span><h2>Recent runs</h2></div></div>
        <div className="history-table-wrap">
          <table className="history-table">
            <thead><tr><th>Run</th><th>When</th><th>Commit</th><th>Result</th><th>Triggered by</th><th /></tr></thead>
            <tbody>
              {history.map((run) => (
                <tr key={run.id}>
                  <td><strong>{run.id}</strong></td>
                  <td>{run.time}</td>
                  <td><code>{run.commit}</code></td>
                  <td><span className={run.violations ? 'run-result run-result--danger' : 'run-result run-result--safe'}>{run.violations ? <XCircle size={14} /> : <CheckCircle2 size={14} />}{run.passed}/8 passed{run.violations ? ` · ${run.violations} failed` : ''}</span></td>
                  <td><span className="actor-badge">{run.actor}</span></td>
                  <td><button className="row-action" aria-label={`View run ${run.id}`}><ArrowRight size={15} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

export default App
