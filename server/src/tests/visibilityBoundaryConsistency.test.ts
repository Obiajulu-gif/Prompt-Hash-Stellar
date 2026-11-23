/**
 * Visibility Boundary Consistency Tests — Issue #913
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  evaluateVisibility,
  isPubliclyVisible,
  buildPublicVisibilityFilter,
  stripSensitivePromptFields,
  sanitizeRelationshipNode,
} from '../../../packages/schema/src/visibility.js';
import {
  enforceRecordVisibility,
  filterVisiblePrompts,
  verifyPublicResultsConsistency,
  sanitizeLineageGraph,
  checkCacheVisibilityDrift,
} from '../services/visibilityService.js';

vi.mock('../services/cacheService.js', () => ({ cacheDel: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../services/auditTrail.js', () => ({ recordAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../services/structuredLogger.js', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { cacheDel } from '../services/cacheService.js';
const mockCacheDel = cacheDel as ReturnType<typeof vi.fn>;
beforeEach(() => vi.clearAllMocks());

const OWNER = 'gbz1111111111111111111111111111111111111111111111111111111';
const OTHER = 'gbz2222222222222222222222222222222222222222222222222222222';

const pub: any = { _id:'pub_001', onChainId:'1001', title:'Stellar Contract Gen', isActive:true, isDeleted:false, deletedAt:null, listingStatus:'published', lifecycleState:'published', visibility:'public', moderationStatus:'none', price:10, owner:{ walletAddress:OWNER }, content:'SECRET', encryptedPrompt:'CIPHER', contentHash:'abc', moderationNotes:'note' };
const priv: any = { _id:'priv_001', onChainId:'1002', title:'Private Prompt', isActive:true, isDeleted:false, deletedAt:null, listingStatus:'published', lifecycleState:'published', visibility:'private', moderationStatus:'none', price:20, owner:{ walletAddress:OWNER }, content:'PRIV', contentHash:'prv' };
const draft: any = { _id:'draft_001', onChainId:'1003', title:'Draft Prompt', isActive:false, isDeleted:false, deletedAt:null, listingStatus:'draft', lifecycleState:'draft', moderationStatus:'none', price:0, owner:{ walletAddress:OWNER } };
const restr: any = { _id:'rest_001', onChainId:'1004', title:'Restricted Prompt', isActive:false, isDeleted:false, deletedAt:null, listingStatus:'published', lifecycleState:'suspended', moderationStatus:'restricted', price:5, owner:{ walletAddress:OWNER } };
const del: any = { _id:'del_001', onChainId:'1005', title:'Deleted Prompt', isDeleted:true, deletedAt:new Date('2025-01-15'), listingStatus:'published', lifecycleState:'published', moderationStatus:'none', price:15, owner:{ walletAddress:OWNER } };
const arch: any = { _id:'arch_001', onChainId:'1006', title:'Archived Prompt', isActive:false, isDeleted:false, deletedAt:null, listingStatus:'archived', lifecycleState:'archived', archivedAt:new Date(), moderationStatus:'none', price:8, owner:{ walletAddress:OWNER } };
const retired: any = { _id:'ret_001', onChainId:'1007', title:'Retired Prompt', isDeleted:false, deletedAt:null, listingStatus:'published', lifecycleState:'retired', moderationStatus:'none', price:5, owner:{ walletAddress:OWNER } };

describe('Issue #913 — Direct Lookup', () => {
  it('public: isPublic=true, HTTP 200', () => {
    const ev = evaluateVisibility(pub);
    expect(ev.visibility).toBe('public'); expect(ev.isPublic).toBe(true); expect(ev.canAccess).toBe(true); expect(ev.httpStatus).toBe(200);
    expect(isPubliclyVisible(pub)).toBe(true);
  });
  it('private: isPublic=false, anonymous HTTP 404', () => {
    const ev = evaluateVisibility(priv);
    expect(ev.visibility).toBe('private'); expect(ev.isPublic).toBe(false); expect(ev.canAccess).toBe(false); expect(ev.httpStatus).toBe(404);
  });
  it('private: owner HTTP 200, stranger HTTP 404', () => {
    expect(evaluateVisibility(priv, { viewerWallet:OWNER }).canAccess).toBe(true);
    expect(evaluateVisibility(priv, { viewerWallet:OTHER }).canAccess).toBe(false);
  });
  it('draft: treated as private, not publicly accessible', () => {
    const ev = evaluateVisibility(draft); expect(ev.visibility).toBe('private'); expect(ev.isPublic).toBe(false);
  });
  it('restricted: HTTP 403 anonymous, HTTP 200 moderator/admin', () => {
    const ev = evaluateVisibility(restr); expect(ev.visibility).toBe('restricted'); expect(ev.httpStatus).toBe(403);
    expect(evaluateVisibility(restr, { role:'moderator' }).canAccess).toBe(true);
    expect(evaluateVisibility(restr, { role:'admin' }).canAccess).toBe(true);
  });
  it('deleted: HTTP 410 for all callers', () => {
    const ev = evaluateVisibility(del); expect(ev.visibility).toBe('deleted'); expect(ev.httpStatus).toBe(410); expect(ev.canAccess).toBe(false);
    expect(evaluateVisibility(del, { role:'admin', viewerWallet:OWNER }).httpStatus).toBe(410);
  });
  it('archived: isPublic=false, canAccess=true (tombstone)', () => {
    const ev = evaluateVisibility(arch); expect(ev.visibility).toBe('archived'); expect(ev.isPublic).toBe(false); expect(ev.canAccess).toBe(true);
  });
  it('retired lifecycleState: treated as deleted, HTTP 410', () => {
    const ev = evaluateVisibility(retired); expect(ev.visibility).toBe('deleted'); expect(ev.httpStatus).toBe(410);
  });
  it('enforceRecordVisibility: null returns 404', () => {
    const r = enforceRecordVisibility(null); expect(r.allowed).toBe(false); expect(r.httpStatus).toBe(404); expect(r.record).toBeNull();
  });
  it('enforceRecordVisibility: sanitizes sensitive fields on allowed access', () => {
    const r = enforceRecordVisibility(pub); expect(r.allowed).toBe(true);
    expect((r.record as any).content).toBeUndefined();
    expect((r.record as any).encryptedPrompt).toBeUndefined();
    expect((r.record as any).contentHash).toBeUndefined();
    expect((r.record as any).moderationNotes).toBeUndefined();
    expect((r.record as any).title).toBe('Stellar Contract Gen');
  });
  it('enforceRecordVisibility: private 404, restricted 403, deleted 410', () => {
    expect(enforceRecordVisibility(priv).httpStatus).toBe(404);
    expect(enforceRecordVisibility(restr).httpStatus).toBe(403);
    expect(enforceRecordVisibility(del).httpStatus).toBe(410);
  });
});

describe('Issue #913 — Search and Discovery', () => {
  it('buildPublicVisibilityFilter: comprehensive exclusions', () => {
    const f = buildPublicVisibilityFilter();
    expect(f.isActive).toBe(true); expect(f.listingStatus).toBe('published');
    for (const s of ['draft','review','hidden','suspended','archived','retired']) expect(f.lifecycleState['\']).toContain(s);
    for (const s of ['restricted','hidden','flagged','rejected']) expect(f.moderationStatus['\']).toContain(s);
    for (const s of ['corrupted','missing']) expect(f.integrityStatus['\']).toContain(s);
  });
  it('filterVisiblePrompts: only public record passes from mixed set', () => {
    const visible = filterVisiblePrompts([pub,priv,draft,restr,del,arch]);
    expect(visible).toHaveLength(1); expect(visible[0]._id).toBe('pub_001');
  });
  it('filterVisiblePrompts: preserves multiple public, strips sensitive fields', () => {
    const pub2 = { ...pub, _id:'pub_002', onChainId:'9999' };
    const results = filterVisiblePrompts([pub, pub2, priv]);
    expect(results).toHaveLength(2);
    expect(results[0].content).toBeUndefined(); expect(results[0].encryptedPrompt).toBeUndefined();
  });
  it('filterVisiblePrompts: empty input returns []', () => { expect(filterVisiblePrompts([])).toEqual([]); });
  it('verifyPublicResultsConsistency: detects all 5 non-public leak types', () => {
    const check = verifyPublicResultsConsistency([priv,draft,restr,del,arch]);
    expect(check.isConsistent).toBe(false); expect(check.violationsCount).toBe(5);
  });
  it('verifyPublicResultsConsistency: passes for all-public set and empty', () => {
    expect(verifyPublicResultsConsistency([pub]).isConsistent).toBe(true);
    expect(verifyPublicResultsConsistency([]).isConsistent).toBe(true);
  });
});

describe('Issue #913 — Export Sensitive Field Redaction', () => {
  it('stripSensitivePromptFields: removes all 7 sensitive fields', () => {
    const record = { ...pub, moderationNotes:'n', moderationReason:'r', searchIndexError:'e', integrityError:'i' };
    const s = stripSensitivePromptFields(record);
    for (const f of ['content','encryptedPrompt','contentHash','moderationNotes','moderationReason','searchIndexError','integrityError'])
      expect((s as any)[f]).toBeUndefined();
  });
  it('stripSensitivePromptFields: preserves safe public metadata', () => {
    const s = stripSensitivePromptFields(pub);
    expect((s as any).title).toBe('Stellar Contract Gen');
    expect((s as any).price).toBe(10); expect((s as any).onChainId).toBe('1001');
  });
  it('stripSensitivePromptFields: no-ops on null/undefined', () => {
    expect(stripSensitivePromptFields(null as any)).toBeNull();
  });
  it('cross-user export blocked for private (404) and deleted (410)', () => {
    expect(enforceRecordVisibility(priv, { viewerWallet:OTHER }).httpStatus).toBe(404);
    expect(enforceRecordVisibility(del, { role:'admin' }).httpStatus).toBe(410);
  });
});

describe('Issue #913 — Relationship Traversal', () => {
  it('sanitizeRelationshipNode: public exposes title/link, private/restricted/deleted are redacted', () => {
    const pubNode = sanitizeRelationshipNode(pub);
    expect(pubNode.title).toBe('Stellar Contract Gen'); expect(pubNode.link).toBe('/prompts/1001'); expect(pubNode.isRedacted).toBe(false);
    for (const p of [priv, restr, del]) {
      const node = sanitizeRelationshipNode(p);
      expect(node.title).toBeNull(); expect(node.link).toBeNull(); expect(node.isRedacted).toBe(true);
    }
  });
  it('sanitizeLineageGraph: redacts non-public ancestors and derivatives', () => {
    const lineage = { promptId:'pub_001', visibility:'public', ancestors:[pub, priv, del], derivatives:[restr] };
    const s = sanitizeLineageGraph(lineage);
    expect(s.ancestors[0].title).toBe('Stellar Contract Gen');
    expect(s.ancestors[1].title).toBeNull(); expect(s.ancestors[1].visibility).toBe('private');
    expect(s.ancestors[2].title).toBeNull(); expect(s.ancestors[2].visibility).toBe('deleted');
    expect(s.derivatives[0].title).toBeNull(); expect(s.derivatives[0].visibility).toBe('restricted');
  });
  it('sanitizeLineageGraph: handles null, undefined, and missing arrays gracefully', () => {
    expect(sanitizeLineageGraph(null as any)).toBeNull();
    expect(sanitizeLineageGraph(undefined as any)).toBeUndefined();
    expect(sanitizeLineageGraph({ promptId:'x', visibility:'public' } as any).promptId).toBe('x');
  });
});

describe('Issue #913 — Stale Cache Visibility Drift', () => {
  it('no drift: public cached and public in source => actionTaken=none', async () => {
    const r = await checkCacheVisibilityDrift('key1', { visibility:'public' }, pub, { autoEvict:true });
    expect(r.isDrifted).toBe(false); expect(r.actionTaken).toBe('none');
    expect(mockCacheDel).not.toHaveBeenCalled();
  });
  it('drift to private: auto-eviction', async () => {
    const nowPriv = { ...pub, visibility:'private' };
    const r = await checkCacheVisibilityDrift('key1', { visibility:'public' }, nowPriv, { autoEvict:true });
    expect(r.isDrifted).toBe(true); expect(r.sourceVisibility).toBe('private'); expect(r.actionTaken).toBe('evicted');
    expect(mockCacheDel).toHaveBeenCalledWith('key1');
  });
  it('drift to deleted: auto-eviction', async () => {
    const r = await checkCacheVisibilityDrift('key2', { visibility:'public' }, del, { autoEvict:true });
    expect(r.isDrifted).toBe(true); expect(r.sourceVisibility).toBe('deleted'); expect(r.actionTaken).toBe('evicted');
  });
  it('drift to restricted: auto-eviction', async () => {
    const r = await checkCacheVisibilityDrift('key3', { visibility:'public' }, restr, { autoEvict:true });
    expect(r.isDrifted).toBe(true); expect(r.sourceVisibility).toBe('restricted'); expect(r.actionTaken).toBe('evicted');
  });
  it('drift detected in dry_run mode: no eviction', async () => {
    const nowDel = { ...pub, isDeleted:true, deletedAt:new Date() };
    const r = await checkCacheVisibilityDrift('key4', { visibility:'public' }, nowDel, { autoEvict:false });
    expect(r.isDrifted).toBe(true); expect(r.actionTaken).toBe('dry_run');
    expect(mockCacheDel).not.toHaveBeenCalled();
  });
  it('inferred public (isActive+listingStatus): drift on deletion triggers eviction', async () => {
    const nowDel = { ...pub, isDeleted:true, deletedAt:new Date() };
    const r = await checkCacheVisibilityDrift('key5', { isActive:true, listingStatus:'published' }, nowDel, { autoEvict:true });
    expect(r.isDrifted).toBe(true); expect(r.actionTaken).toBe('evicted');
  });
  it('cached private: no drift even if source is private', async () => {
    const r = await checkCacheVisibilityDrift('key6', { visibility:'private' }, priv, { autoEvict:true });
    expect(r.isDrifted).toBe(false); expect(r.actionTaken).toBe('none');
  });
});

describe('Issue #913 — Indirect Reference Leakage Prevention', () => {
  it('isPubliclyVisible=false for all non-public states', () => {
    for (const p of [priv, draft, restr, del, arch, retired]) expect(isPubliclyVisible(p)).toBe(false);
  });
  it('filterVisiblePrompts: order-independent, only public passes', () => {
    const shuffled = [del, pub, arch, restr, priv, draft];
    const visible = filterVisiblePrompts(shuffled);
    expect(visible).toHaveLength(1); expect(visible[0]._id).toBe('pub_001');
  });
  it('evaluateVisibility: no crash on null/undefined/empty/string', () => {
    for (const bad of [null, undefined, {}, 'string']) expect(() => evaluateVisibility(bad as any)).not.toThrow();
    expect(evaluateVisibility(null).isPublic).toBe(false);
  });
  it('walletAddress comparison is case-insensitive', () => {
    const mixed = { ...priv, owner:{ walletAddress:OWNER.toUpperCase() } };
    expect(evaluateVisibility(mixed, { viewerWallet:OWNER.toLowerCase() }).canAccess).toBe(true);
  });
});
