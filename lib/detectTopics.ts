import { InternalsTag, RawItem } from '@/types'

export interface TopicEntry {
  tag:   InternalsTag
  label: string
  color: string
}

export const TOPIC_LIST: TopicEntry[] = [
  { tag: 'planner',        label: 'planner',       color: 'bg-pg-purple' },
  { tag: 'executor',       label: 'executor',      color: 'bg-pg-teal' },
  { tag: 'WAL',            label: 'WAL',           color: 'bg-orange-500' },
  { tag: 'replication',    label: 'replication',   color: 'bg-cyan-600' },
  { tag: 'VACUUM',         label: 'vacuum',        color: 'bg-green-600' },
  { tag: 'MVCC',           label: 'MVCC',          color: 'bg-indigo-500' },
  { tag: 'buffer manager', label: 'buffers',       color: 'bg-blue-500' },
  { tag: 'lock manager',   label: 'locks',         color: 'bg-red-500' },
  { tag: 'memory',         label: 'memory',        color: 'bg-yellow-600' },
  { tag: 'storage',        label: 'storage',       color: 'bg-stone-500' },
  { tag: 'parallel query', label: 'parallel',      color: 'bg-pg-blue' },
  { tag: 'partitioning',   label: 'partitioning',  color: 'bg-pink-600' },
  { tag: 'AIO',            label: 'AIO',           color: 'bg-violet-600' },
]

type Rule = { tag: InternalsTag; patterns: RegExp[] }

const RULES: Rule[] = [
  {
    tag: 'WAL',
    patterns: [/\bwal\b/i, /write.ahead.log/i, /\bwalwriter\b/i, /\bwal_level\b/i, /\bxlog\b/i, /\bwal_file/i],
  },
  {
    tag: 'MVCC',
    patterns: [/\bmvcc\b/i, /\bsnapshot\b/i, /\bxid\b/i, /\bxmin\b/i, /\bxmax\b/i, /visibility/i, /transaction id/i],
  },
  {
    tag: 'planner',
    patterns: [/\bplanner\b/i, /\boptimizer\b/i, /query plan/i, /cost estim/i, /\bselectivity\b/i, /\bstatistic/i, /plan node/i, /\bjoin order/i, /\bpath.*cost\b/i],
  },
  {
    tag: 'executor',
    patterns: [/\bexecutor\b/i, /\bexec node/i, /\bhash join\b/i, /nested loop/i, /\baggregate\b/i, /sort node/i, /\btuple.*store/i],
  },
  {
    tag: 'buffer manager',
    patterns: [/\bbuffer manager\b/i, /\bshared.buffer/i, /\bbgwriter\b/i, /\bbuffer pool\b/i, /\bbuffer.ring\b/i, /\brelation.*cache\b/i],
  },
  {
    tag: 'replication',
    patterns: [/\breplication\b/i, /\breplica\b/i, /\bstandby\b/i, /\bstreaming rep/i, /logical.decod/i, /repl.*slot/i, /\bpublication\b/i, /\bsubscription\b/i],
  },
  {
    tag: 'VACUUM',
    patterns: [/\bvacuum\b/i, /\bautovacuum\b/i, /\bfreezing\b/i, /dead.tuple/i, /\bbloat\b/i, /freeze.*age/i, /\bvacuum.*worker\b/i],
  },
  {
    tag: 'lock manager',
    patterns: [/\block manager\b/i, /\bdeadlock\b/i, /\blwlock\b/i, /\bspinlock\b/i, /\bwait event\b/i, /lock.*contention/i, /\block.*mode\b/i],
  },
  {
    tag: 'memory',
    patterns: [/\bmemorycontext\b/i, /\bpalloc\b/i, /\bwork_mem\b/i, /\bout.of.memory\b/i, /\bmmap\b/i, /\bmemory.*usage\b/i, /\bguc.*mem\b/i],
  },
  {
    tag: 'storage',
    patterns: [/\bheap.*storage\b/i, /\btoast\b/i, /\bfsync\b/i, /\btablespace\b/i, /\bpage.*layout\b/i, /relation.*file/i, /\bblock.*io\b/i],
  },
  {
    tag: 'parallel query',
    patterns: [/parallel.quer/i, /parallel.worker/i, /\bgather\b/i, /parallel.exec/i, /\bworker.process\b/i],
  },
  {
    tag: 'partitioning',
    patterns: [/\bpartition/i],
  },
  {
    tag: 'AIO',
    patterns: [/\baio\b/i, /async.*i\/o/i, /asynchronous.i\/o/i, /\bio_method\b/i, /\bio_uring\b/i, /\bdirect.i\/o\b/i],
  },
]

/**
 * Returns the list of InternalsTag values that match the item's title + snippet.
 * Pure keyword matching — no network calls.
 */
export function detectTopics(item: RawItem): InternalsTag[] {
  const text = `${item.title} ${item.snippet}`
  return RULES.filter(r => r.patterns.some(p => p.test(text))).map(r => r.tag)
}
