import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Code2,
  Copy,
  Database,
  ExternalLink,
  FileCheck2,
  Fingerprint,
  GitFork,
  KeyRound,
  Layers3,
  LockKeyhole,
  Play,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  TestTube2,
  XCircle,
  Zap,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { demoSystem, safeFaults, starterFaults } from './data'
import type {
  FaultConfig,
  FaultMode,
  ProbeAssertion,
  ProbeResult,
  TraceStage,
} from './domain'
import { evaluateSuite } from './simulator'

interface FaultSpec {
  key: FaultMode
  title: string
  description: string
  impact: string
  icon: typeof ShieldAlert
}

type ToastTone = 'success' | 'danger'

interface Toast {
  message: string
  tone: ToastTone
}

const faultSpecs: FaultSpec[] = [
  {
    key: 'identity-blind-cache',
    title: 'Shared cache key',
    description: 'A result is keyed only by the query, not by the caller or their permissions.',
    impact: 'Can replay a Finance result to someone in Newsroom.',
    icon: Zap,
  },
  {
    key: 'post-retrieval-filter',
    title: 'Filter after retrieval',
    description: 'Authorization happens after top-k chunks have already been selected.',
    impact: 'Restricted context can reach prompts, citations, and caches.',
    icon: Layers3,
  },
  {
    key: 'acl-sync-delay',
    title: 'Stale index permissions',
    description: 'The vector index still believes an access grant exists after it has been revoked.',
    impact: 'Recently restricted material can remain searchable.',
    icon: KeyRound,
  },
  {
    key: 'cross-boundary-chunks',
    title: 'Mixed-security chunks',
    description: 'One embedding combines content that has different access rules.',
    impact: 'Public context can carry a restricted appendix with it.',
    icon: Database,
  },
]

const quickStart = `npm install -g contextfence@0.2.0
curl -fsSLO https://raw.githubusercontent.com/devectorio/contextfence/v0.2.0/examples/contracts/mock.boundary.yaml
contextfence test mock.boundary.yaml`

function assertionSubject(assertion: ProbeAssertion) {
  if (assertion.kind === 'source') {
    return demoSystem.sources.find((source) => source.id === assertion.sourceId)?.name ?? assertion.sourceId
  }
  return demoSystem.canaries.find((canary) => canary.id === assertion.canaryId)?.token ?? assertion.canaryId
}

function assertionLabel(assertion: ProbeAssertion) {
  return `${assertion.expectation === 'present' ? 'Must retrieve' : 'Must not retrieve'} ${assertionSubject(assertion)}`
}

function traceIcon(stage: TraceStage) {
  if (stage === 'identity') return Fingerprint
  if (stage === 'cache') return Zap
  if (stage === 'policy' || stage === 'post-filter') return ShieldCheck
  if (stage === 'retrieval') return Database
  if (stage === 'context') return FileCheck2
  return TestTube2
}

function FaultToggle({
  spec,
  enabled,
  disabled,
  onChange,
}: {
  spec: FaultSpec
  enabled: boolean
  disabled: boolean
  onChange: (enabled: boolean) => void
}) {
  const Icon = spec.icon
  const className = `lab-fault${enabled ? ' lab-fault--enabled' : ''}${disabled ? ' lab-fault--disabled' : ''}`
  return (
    <label className={className}>
      <input
        type="checkbox"
        checked={enabled}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="lab-fault__icon"><Icon size={18} aria-hidden="true" /></span>
      <span className="lab-fault__copy">
        <strong>{spec.title}</strong>
        <span>{spec.description}</span>
        <em>{spec.impact}</em>
      </span>
      <span className="lab-switch" aria-hidden="true"><i /></span>
    </label>
  )
}

function Trace({ probe }: { probe: ProbeResult }) {
  return (
    <ol className="lab-trace" aria-label={`Permission trace for ${probe.name}`}>
      {probe.trace.filter((step) => step.status !== 'skipped').map((step) => {
        const Icon = traceIcon(step.stage)
        return (
          <li className={`lab-trace__step lab-trace__step--${step.status}`} key={step.id}>
            <span className="lab-trace__icon"><Icon size={16} aria-hidden="true" /></span>
            <span>
              <strong>{step.label}</strong>
              <small>{step.detail}</small>
            </span>
            <span className="lab-trace__status">
              {step.status === 'fail' ? <AlertTriangle size={14} /> : step.status === 'pass' ? <Check size={14} /> : <ShieldAlert size={14} />}
              {step.status}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function App() {
  const [faults, setFaults] = useState<FaultConfig>(() => ({ ...starterFaults }))
  const [executedFaults, setExecutedFaults] = useState<FaultConfig>(() => ({ ...starterFaults }))
  const [suite, setSuite] = useState(() => evaluateSuite(demoSystem, starterFaults))
  const [selectedProbeId, setSelectedProbeId] = useState('probe-cache-isolation')
  const [running, setRunning] = useState(false)
  const [hasRun, setHasRun] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const runSequence = useRef(0)
  const resultsRef = useRef<HTMLElement>(null)

  const selectedProbe =
    suite.probes.find((probe) => probe.id === selectedProbeId) ??
    suite.probes.find((probe) => probe.status === 'failed') ??
    suite.probes[0]
  const enabledFaultCount = faultSpecs.filter((fault) => faults[fault.key]).length
  const hasUnrunChanges = faultSpecs.some((fault) => faults[fault.key] !== executedFaults[fault.key])
  const heroRunLabel = running
    ? 'Running deterministic checks…'
    : hasUnrunChanges
      ? 'Run the updated 8-check demo'
      : faults['identity-blind-cache']
        ? 'Watch the cache leak'
        : 'Run the 8-check demo'

  function notify(message: string, tone: ToastTone = 'success') {
    setToast({ message, tone })
    window.setTimeout(() => setToast(null), 2800)
  }

  async function runSuite(
    nextFaults: FaultConfig = faults,
    preferredProbeId?: string,
    revealResults = false,
  ) {
    if (running) return
    const sequence = ++runSequence.current
    setRunning(true)
    await new Promise<void>((resolve) => window.setTimeout(resolve, 560))
    if (sequence !== runSequence.current) return

    const nextSuite = evaluateSuite(demoSystem, nextFaults)
    const firstFailure = nextSuite.probes.find((probe) => probe.status === 'failed')
    const preferredProbe = nextSuite.probes.find((probe) => probe.id === preferredProbeId)
    setSuite(nextSuite)
    setExecutedFaults({ ...nextFaults })
    setSelectedProbeId(preferredProbe?.id ?? firstFailure?.id ?? nextSuite.probes[0].id)
    setHasRun(true)
    setRunning(false)
    if (revealResults) {
      window.requestAnimationFrame(() => {
        resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        resultsRef.current?.focus({ preventScroll: true })
      })
    }
    notify(
      nextSuite.violationCount
        ? `${nextSuite.violationCount} permission checks found a boundary failure`
        : 'All permission checks passed — the synthetic boundary held',
      nextSuite.violationCount ? 'danger' : 'success',
    )
  }

  function changeFault(key: FaultMode, enabled: boolean) {
    if (running) return
    setFaults((current) => ({ ...current, [key]: enabled }))
  }

  function fixEverything() {
    if (running) return
    setFaults({ ...safeFaults })
    void runSuite({ ...safeFaults }, 'probe-cache-isolation')
  }

  async function copyQuickStart() {
    try {
      await navigator.clipboard.writeText(quickStart)
      notify('Published quick start copied')
    } catch {
      notify('Copy is unavailable in this browser — use the install link instead')
    }
  }

  function jumpToHowItWorks() {
    document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })
  }

  if (!selectedProbe) return null

  return (
    <div className="lab-app">
      <header className="lab-nav">
        <a className="lab-brand" href="#top" aria-label="ContextFence home">
          <span className="lab-brand__mark" aria-hidden="true"><i /><i /><i /><i /><b /></span>
          <span>context<span>fence</span></span>
        </a>
        <nav aria-label="Demo navigation">
          <a href="#how-it-works">What it does</a>
          <a href="#explore">Try the lab</a>
          <a href="#run-in-ci">Install &amp; CI</a>
          <a href="#assessment">Assessment</a>
        </nav>
        <a className="lab-source-link" href="https://github.com/devectorio/contextfence" target="_blank" rel="noreferrer">
          <GitFork size={15} aria-hidden="true" /> GitHub <ExternalLink size={13} aria-hidden="true" />
        </a>
      </header>

      <main id="top">
        <section className="lab-hero">
          <div className="lab-hero__copy">
            <p className="lab-eyebrow"><Sparkles size={15} aria-hidden="true" /> Interactive synthetic RAG authorization lab</p>
            <h1>Could a Finance answer leak to someone in Newsroom?</h1>
            <p className="lab-hero__lede">
              ContextFence turns declared identity × source boundaries into deterministic regression tests. It checks whether a target exposes unauthorized content or source evidence — not just whether a final answer looks redacted.
            </p>
            <p className="lab-hero__explain">
              Start with one deliberately broken cache key: Finance primes a result, then Newsroom asks the same question. Run the eight checks, inspect the exact simulated path that crossed the boundary, then add the other failure modes.
            </p>
            <div className="lab-actions">
              <button className="lab-button lab-button--primary" onClick={() => void runSuite(faults, 'probe-cache-isolation', true)} disabled={running}>
                {running ? <TestTube2 className="lab-spin" size={17} aria-hidden="true" /> : <Play size={16} fill="currentColor" aria-hidden="true" />}
                {heroRunLabel}
              </button>
              <button className="lab-button lab-button--quiet" onClick={jumpToHowItWorks}>
                How ContextFence works <ArrowRight size={16} aria-hidden="true" />
              </button>
            </div>
            <nav className="lab-oss-links" aria-label="ContextFence open-source paths">
              <a href="https://www.npmjs.com/package/contextfence" target="_blank" rel="noreferrer"><TerminalSquare size={15} aria-hidden="true" /> Install package <ExternalLink size={13} aria-hidden="true" /></a>
              <a href="https://github.com/devectorio/contextfence/blob/main/docs/github-action.md" target="_blank" rel="noreferrer"><FileCheck2 size={15} aria-hidden="true" /> Use the GitHub Action <ExternalLink size={13} aria-hidden="true" /></a>
              <a href="https://github.com/devectorio/contextfence" target="_blank" rel="noreferrer"><GitFork size={15} aria-hidden="true" /> Star on GitHub <ExternalLink size={13} aria-hidden="true" /></a>
            </nav>
            <p className="lab-hero__note"><LockKeyhole size={14} aria-hidden="true" /> Synthetic data only. No target credentials, prompts, or production systems are involved.</p>
          </div>

          <aside className="lab-scenario" aria-label="The featured cache-isolation scenario">
            <p>Featured proof</p>
            <h2>A cache must remember <em>who</em> asked.</h2>
            <ol>
              <li><span>01</span><div><strong>Finance primes the cache</strong><small>Omar retrieves a protected margin forecast.</small></div></li>
              <li><span>02</span><div><strong>Newsroom asks the same question</strong><small>Maya must not inherit Omar&apos;s context.</small></div></li>
              <li><span>03</span><div><strong>The contract proves the outcome</strong><small>Finance sources and canaries must be absent.</small></div></li>
            </ol>
            <div className="lab-scenario__assertion"><Fingerprint size={17} /><code>Finance Vault must be absent</code></div>
          </aside>
        </section>

        <section className="lab-how" id="how-it-works">
          <div className="lab-section-heading">
            <p>What ContextFence actually does</p>
            <h2>It makes permission failures concrete, repeatable, and reviewable.</h2>
          </div>
          <div className="lab-how__grid">
            <article>
              <span>01</span>
              <Fingerprint size={21} aria-hidden="true" />
              <h3>Run as a real identity</h3>
              <p>Each probe declares an identity and request shape. The runner sends its configured headers and system prompt to the target you authorize.</p>
            </article>
            <article>
              <span>02</span>
              <Database size={21} aria-hidden="true" />
              <h3>Evaluate exposed evidence</h3>
              <p>The runner checks response content and source or citation metadata the target exposes. This simulator additionally visualizes cache and retrieval paths.</p>
            </article>
            <article>
              <span>03</span>
              <ShieldCheck size={21} aria-hidden="true" />
              <h3>Fail on a declared boundary</h3>
              <p>A pass means this explicit contract held in that run. It is evidence for a boundary — not a vague safety score.</p>
            </article>
          </div>
        </section>

        <section className="lab-workspace" id="explore">
          <section className="lab-config lab-card">
            <div className="lab-card__heading">
              <div>
                <p>1. Reproduce a boundary failure</p>
                <h2>Start with a shared cache key.</h2>
              </div>
              <span className={enabledFaultCount ? 'lab-count lab-count--danger' : 'lab-count'}>
                {enabledFaultCount ? `${enabledFaultCount} fault${enabledFaultCount === 1 ? '' : 's'} enabled` : 'safe configuration'}
              </span>
            </div>
            <p className="lab-card__intro">
              Each switch simulates one implementation defect; none changes a real service. The baseline enables only the cache fault, so its Finance-to-Newsroom replay is easy to trace before you add more variables.
            </p>
            <div className="lab-fault-list">
              {faultSpecs.map((spec) => (
                <FaultToggle
                  key={spec.key}
                  spec={spec}
                  enabled={faults[spec.key]}
                  disabled={running}
                  onChange={(enabled) => changeFault(spec.key, enabled)}
                />
              ))}
            </div>
            <div className="lab-config__actions">
              <button className="lab-button lab-button--primary" onClick={() => void runSuite()} disabled={running}>
                {running ? <TestTube2 className="lab-spin" size={16} /> : <Play size={15} fill="currentColor" />}
                {running ? 'Running…' : 'Run this contract'}
              </button>
              <button className="lab-button lab-button--quiet" onClick={fixEverything} disabled={running || enabledFaultCount === 0}>
                <Sparkles size={15} /> Apply all four fixes
              </button>
            </div>
          </section>

          <section className="lab-results lab-card" ref={resultsRef} tabIndex={-1}>
            <div className="lab-card__heading">
              <div>
                <p>{hasUnrunChanges ? '2. Configuration changed — results are from the last run.' : hasRun ? '2. Fresh synthetic run' : '2. Baseline: one shared-cache fault is enabled'}</p>
                <h2 aria-live="polite" aria-atomic="true">{suite.violationCount ? `${suite.violationCount} of ${suite.probes.length} permission checks failed.` : `All ${suite.probes.length} permission checks passed.`}</h2>
              </div>
              <span className={suite.violationCount ? 'lab-status lab-status--danger' : 'lab-status lab-status--safe'}>
                {suite.violationCount ? <ShieldAlert size={15} /> : <ShieldCheck size={15} />}
                {suite.risk.label}
              </span>
            </div>
            <p className="lab-card__intro">{suite.risk.rationale[0]}</p>
            <div className="lab-metrics" aria-label="Synthetic suite summary">
              <span><small>Checks</small><strong>{suite.probes.length}</strong></span>
              <span><small>Passed</small><strong>{suite.passCount}</strong></span>
              <span><small>Failed</small><strong>{suite.violationCount}</strong></span>
              <span><small>Unauthorized chunks</small><strong>{suite.boundaryMetrics.unauthorizedChunks}</strong></span>
            </div>
            <div className="lab-probe-list" aria-label="Permission checks">
              {suite.probes.map((probe) => (
                <button
                  key={probe.id}
                  className={selectedProbe.id === probe.id ? 'lab-probe lab-probe--selected' : 'lab-probe'}
                  onClick={() => setSelectedProbeId(probe.id)}
                  aria-pressed={selectedProbe.id === probe.id}
                >
                  <span className={probe.status === 'failed' ? 'lab-probe__mark lab-probe__mark--fail' : 'lab-probe__mark'}>
                    {probe.status === 'failed' ? <XCircle size={16} /> : <CheckCircle2 size={16} />}
                  </span>
                  <span><strong>{probe.name}</strong><small>{probe.identity.name} · {probe.category.replaceAll('-', ' ')}</small></span>
                  <ArrowRight size={15} aria-hidden="true" />
                </button>
              ))}
            </div>
          </section>
        </section>

        <section className="lab-evidence lab-card" aria-label="Selected permission-check evidence">
          <div className="lab-card__heading">
            <div>
              <p>3. Inspect the proof</p>
              <h2>{selectedProbe.name}</h2>
            </div>
            <span className={selectedProbe.status === 'failed' ? 'lab-status lab-status--danger' : 'lab-status lab-status--safe'}>
              {selectedProbe.status === 'failed' ? <ShieldAlert size={15} /> : <ShieldCheck size={15} />}
              {selectedProbe.status === 'failed' ? `${selectedProbe.severity} violation` : 'boundary held'}
            </span>
          </div>
          <p className="lab-evidence__summary">{selectedProbe.summary}</p>

          <div className="lab-evidence__grid">
            <article>
              <span className="lab-evidence__label"><Fingerprint size={15} /> Expected boundary</span>
              <h3>{selectedProbe.identity.name}<small>{selectedProbe.identity.title}</small></h3>
              <p>{selectedProbe.description}</p>
              <ul className="lab-assertions">
                {selectedProbe.assertions.map((assertion) => (
                  <li className={assertion.passed ? 'lab-assertion lab-assertion--pass' : 'lab-assertion lab-assertion--fail'} key={`${assertion.assertion.kind}-${assertion.assertion.kind === 'source' ? assertion.assertion.sourceId : assertion.assertion.canaryId}`}>
                    {assertion.passed ? <Check size={14} /> : <AlertTriangle size={14} />}
                    <span><strong>{assertionLabel(assertion.assertion)}</strong><small>{assertion.message}</small></span>
                  </li>
                ))}
              </ul>
            </article>

            <article>
              <span className="lab-evidence__label"><Database size={15} /> What reached model context</span>
              {selectedProbe.contextChunks.length ? (
                <ul className="lab-context-list">
                  {selectedProbe.contextChunks.map((chunk) => (
                    <li className={chunk.authorized ? '' : 'lab-context-list__item--unauthorized'} key={chunk.chunkId}>
                      <span>{chunk.authorized ? <CheckCircle2 size={15} /> : <ShieldAlert size={15} />}</span>
                      <div><strong>{chunk.sourceName}</strong><small>{chunk.authorized ? 'Authorized for this identity' : 'Unauthorized context — this is the failure'}</small></div>
                    </li>
                  ))}
                </ul>
              ) : <p className="lab-empty">No retrieved chunks crossed into this negative-control context.</p>}
              {selectedProbe.evidence.length ? (
                <div className="lab-proof">
                  <span><AlertTriangle size={15} /> Deterministic evidence</span>
                  {selectedProbe.evidence.map((evidence) => <strong key={`${evidence.kind}-${evidence.id}`}>{evidence.label} — {evidence.detail}</strong>)}
                </div>
              ) : <div className="lab-proof lab-proof--safe"><span><CheckCircle2 size={15} /> Deterministic evidence</span><strong>Every declared assertion passed for this run.</strong></div>}
            </article>
          </div>

          <div className="lab-trace-wrap">
            <div><span className="lab-evidence__label"><Code2 size={15} /> Simulated retrieval trace</span><p>This browser lab shows the simulated path. The production runner evaluates target response and source or citation evidence it receives.</p></div>
            <Trace probe={selectedProbe} />
          </div>

          <aside className={selectedProbe.status === 'failed' ? 'lab-remediation' : 'lab-remediation lab-remediation--safe'}>
            {selectedProbe.status === 'failed' ? <ShieldAlert size={19} /> : <ShieldCheck size={19} />}
            <div><span>{selectedProbe.status === 'failed' ? 'Suggested remediation' : 'Why this passed'}</span><strong>{selectedProbe.remediation}</strong></div>
          </aside>
        </section>

        <section className="lab-run-source" id="run-in-ci">
          <div>
            <p className="lab-eyebrow"><TerminalSquare size={15} /> Install the published runner</p>
            <h2>Put an identity × source contract in CI today.</h2>
            <p>
              This page is a synthetic explainer. The Apache-2.0 runner is published on npm, executes versioned contracts against systems you are authorized to test, and produces JSON, JUnit, SARIF, and HTML evidence. Start with the network-free mock suite, then use the pinned GitHub Action for a real staging boundary.
            </p>
            <div className="lab-actions">
              <button className="lab-button lab-button--primary" onClick={() => void copyQuickStart()}><Copy size={16} /> Copy quick start</button>
              <a className="lab-button lab-button--quiet" href="https://github.com/devectorio/contextfence/blob/main/docs/github-action.md" target="_blank" rel="noreferrer">Use the GitHub Action <ExternalLink size={16} /></a>
            </div>
          </div>
          <pre aria-label="Install ContextFence and run the network-free starter contract"><code>{quickStart}</code></pre>
        </section>

        <section className="lab-assessment" id="assessment">
          <div className="lab-assessment__intro">
            <p className="lab-eyebrow"><ShieldCheck size={15} /> Fixed-scope implementation help</p>
            <h2>Turn a promising demo into a release control.</h2>
            <p>
              Keep the open-source runner either way. For teams with a live RAG system, Devector can deliver a <strong>ContextFence Boundary Baseline</strong>: a fixed-scope, one-to-two-week engagement that leaves behind an identity × source map, synthetic canaries, executable checks, and evidence your engineers can rerun.
            </p>
            <div className="lab-actions">
              <a className="lab-button lab-button--primary" href="https://www.devector.io/contact" target="_blank" rel="noreferrer">Scope a Boundary Baseline <ArrowRight size={16} /></a>
              <a className="lab-button lab-button--quiet" href="mailto:dev@devector.io?subject=ContextFence%20design%20partner">Discuss the design-partner track <ExternalLink size={16} /></a>
            </div>
            <p className="lab-assessment__note"><strong>Design-partner track:</strong> run history, private runners, connector workflows, and evidence retention are a future hosted direction—not a service being claimed today.</p>
          </div>
          <ol className="lab-assessment__steps">
            <li><span>01</span><div><strong>Map the boundary</strong><p>Identify test identities, sensitive sources, access changes, and the evidence the target can expose.</p></div></li>
            <li><span>02</span><div><strong>Prove the failure modes</strong><p>Seed safe canaries and build an initial 20–40 deterministic checks around the paths that matter.</p></div></li>
            <li><span>03</span><div><strong>Leave with a gate</strong><p>Hand over a reviewed CI change, portable evidence report, remediation priorities, and an engineer walkthrough.</p></div></li>
          </ol>
        </section>
      </main>

      <footer className="lab-footer">
        <span>ContextFence is Apache-2.0 open source, not a security certification.</span>
        <a href="https://www.devector.io/" target="_blank" rel="noreferrer">A Devector project <ExternalLink size={13} /></a>
      </footer>

      {toast ? <div className={`lab-toast lab-toast--${toast.tone}`} role={toast.tone === 'danger' ? 'alert' : 'status'}>{toast.tone === 'danger' ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />} {toast.message}</div> : null}
    </div>
  )
}

export default App
