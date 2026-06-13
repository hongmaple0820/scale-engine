import { defineCommand } from 'citty'
import { join } from 'node:path'
import { InstinctExtractor } from '../cortex/InstinctExtractor.js'
import { InstinctStore } from '../cortex/InstinctStore.js'
import { formatRejectedCandidate, reviewInstinctCandidates, type ReviewedInstinctCandidate } from '../cortex/InstinctCandidateReview.js'
import { recordCandidateRejection } from '../cortex/InstinctCandidateAudit.js'

export const cortexApproveCommand = defineCommand({
  meta: {
    name: 'approve',
    description: 'Approve a reviewed Cortex candidate and save it to .scale/instincts',
  },
  args: {
    candidateId: { type: 'positional', required: true, description: 'Candidate instinct id from cortex extract --json' },
    dir: { type: 'string', default: process.cwd(), description: 'Project directory' },
    'allow-stale': { type: 'boolean', default: false, description: 'Allow approving stale candidates explicitly' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = String(args.dir ?? process.cwd())
    const scaleDir = join(projectDir, '.scale')
    const candidateId = String(args.candidateId)
    const allowStale = args['allow-stale'] === true
    const review = findCandidate(scaleDir, candidateId)

    if (!review) {
      writeApproveResult(args.json === true, { approved: false, candidateId, error: 'candidate-not-found' })
      process.exitCode = 1
      return
    }

    if (review.status !== 'accepted' && !allowStale) {
      writeApproveResult(args.json === true, {
        approved: false,
        candidateId,
        error: 'candidate-not-accepted',
        candidate: formatRejectedCandidate(review),
      })
      process.exitCode = 1
      return
    }

    const store = new InstinctStore(join(scaleDir, 'instincts'))
    const savedId = store.save(review.instinct)
    writeApproveResult(args.json === true, {
      approved: Boolean(savedId),
      candidateId,
      savedId,
      status: review.status,
      reasons: review.reasons,
    })
    if (!savedId) process.exitCode = 1
  },
})

export const cortexRejectCommand = defineCommand({
  meta: {
    name: 'reject',
    description: 'Reject a reviewed Cortex candidate and record an audit entry without saving it',
  },
  args: {
    candidateId: { type: 'positional', required: true, description: 'Candidate instinct id from cortex extract --json' },
    dir: { type: 'string', default: process.cwd(), description: 'Project directory' },
    reason: { type: 'string', default: 'manual-reject', description: 'Reason recorded in the Cortex audit log' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = String(args.dir ?? process.cwd())
    const scaleDir = join(projectDir, '.scale')
    const candidateId = String(args.candidateId)
    const review = findCandidate(scaleDir, candidateId)

    if (!review) {
      writeRejectResult(args.json === true, { rejected: false, candidateId, error: 'candidate-not-found' })
      process.exitCode = 1
      return
    }

    const audit = recordCandidateRejection(join(scaleDir, 'instincts'), review.instinct, String(args.reason ?? 'manual-reject'), [
      `candidate-id:${candidateId}`,
      `candidate-status:${review.status}`,
      ...review.reasons,
    ])

    writeRejectResult(args.json === true, {
      rejected: true,
      candidateId,
      auditId: audit.auditId,
      status: review.status,
      reasons: review.reasons,
    })
  },
})

function findCandidate(scaleDir: string, candidateId: string): ReviewedInstinctCandidate | undefined {
  const extractor = new InstinctExtractor(scaleDir)
  const observations = extractor.loadObservations()
  const patterns = extractor.detectPatterns(observations)
  const instincts = extractor.extract(patterns)
  return reviewInstinctCandidates(instincts, patterns, observations)
    .find(review => review.instinct.id === candidateId)
}

function writeApproveResult(json: boolean, result: Record<string, unknown>): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (result.approved) {
    console.log(`Approved Cortex candidate ${result.candidateId} -> ${result.savedId}`)
  } else {
    console.error(`Failed to approve Cortex candidate ${result.candidateId}: ${result.error}`)
  }
}

function writeRejectResult(json: boolean, result: Record<string, unknown>): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (result.rejected) {
    console.log(`Rejected Cortex candidate ${result.candidateId}; audit=${result.auditId}`)
  } else {
    console.error(`Failed to reject Cortex candidate ${result.candidateId}: ${result.error}`)
  }
}
