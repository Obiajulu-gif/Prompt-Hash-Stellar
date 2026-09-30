/**
 * Provenance Viewer Component (#929)
 * 
 * Displays provenance information for a prompt including:
 * - Import source and batch information
 * - Transformation history
 * - Actor metadata
 * - Parent/child relationships
 * - Lineage tree visualization
 */

import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  Archive,
  Bot,
  Check,
  Clock,
  Database,
  FileUp,
  Globe,
  GitFork,
  GitMerge,
  Package,
  Shuffle,
  Upload,
  User,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ── Types ─────────────────────────────────────────────────────────────────────

type ImportSourceType =
  | "manual"
  | "api"
  | "file_upload"
  | "migration"
  | "external_api"
  | "fork"
  | "template"
  | "ai_generated"
  | "system";

type TransformType =
  | "none"
  | "translation"
  | "summarization"
  | "expansion"
  | "format_conversion"
  | "ai_enhancement"
  | "merge"
  | "extraction"
  | "customization";

interface ProvenanceRecord {
  _id: string;
  promptId: string;
  onChainId?: string;
  sourceType: ImportSourceType;
  importBatch?: {
    batchId: string;
    totalItems: number;
    importedAt: string;
    importedBy: string;
  };
  sourceSystem: {
    name: string;
    version: string;
    identifier: string;
  };
  transformations: Array<{
    transformType: TransformType;
    timestamp: string;
    actor: {
      actorType: "user" | "system" | "service" | "admin";
      actorId: string;
      actorName?: string;
      actorWallet?: string;
      actorEmail?: string;
      actorRole?: string;
      actorIp?: string;
      actorUserAgent?: string;
    };
    details: string;
  }>;
  actor: {
    actorType: "user" | "system" | "service" | "admin";
    actorId: string;
    actorName?: string;
    actorWallet?: string;
    actorEmail?: string;
    actorRole?: string;
    actorIp?: string;
    actorUserAgent?: string;
  };
  parentRecordId?: string;
  childRecordIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface ProvenanceViewerProps {
  promptId: string;
  onChainId?: string;
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function fetchProvenance(promptId: string): Promise<ProvenanceRecord | null> {
  const res = await fetch(`/api/provenance/record/${promptId}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to fetch provenance: ${res.status}`);
  return res.json();
}

async function fetchLineage(promptId: string) {
  const res = await fetch(`/api/provenance/lineage/${promptId}`);
  if (!res.ok) throw new Error(`Failed to fetch lineage: ${res.status}`);
  return res.json();
}

async function fetchDerivatives(promptId: string) {
  const res = await fetch(`/api/provenance/derivatives-enhanced/${promptId}`);
  if (!res.ok) throw new Error(`Failed to fetch derivatives: ${res.status}`);
  return res.json();
}

// ── Icon mapping ──────────────────────────────────────────────────────────────

const SOURCE_TYPE_ICONS: Record<ImportSourceType, React.ComponentType<any>> = {
  manual: User,
  api: Globe,
  file_upload: FileUp,
  migration: Archive,
  external_api: Database,
  fork: GitFork,
  template: Package,
  ai_generated: Bot,
  system: Shuffle,
};

const TRANSFORM_TYPE_ICONS: Record<TransformType, React.ComponentType<any>> = {
  none: Clock,
  translation: Globe,
  summarization: Users,
  expansion: Upload,
  format_conversion: Shuffle,
  ai_enhancement: Bot,
  merge: GitMerge,
  extraction: Package,
  customization: Check,
};

// ── Component ─────────────────────────────────────────────────────────────────

export function ProvenanceViewer({ promptId, onChainId }: ProvenanceViewerProps) {
  const { data: provenance, isLoading, error } = useQuery({
    queryKey: ["provenance", promptId],
    queryFn: () => fetchProvenance(promptId),
  });

  const { data: lineage } = useQuery({
    queryKey: ["provenance-lineage", promptId],
    queryFn: () => fetchLineage(promptId),
    enabled: !!provenance,
  });

  const { data: derivatives } = useQuery({
    queryKey: ["provenance-derivatives", promptId],
    queryFn: () => fetchDerivatives(promptId),
    enabled: !!provenance,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-96" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <p>Failed to load provenance information</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!provenance) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 text-muted-foreground">
            <AlertCircle className="h-5 w-5" />
            <p>No provenance information available for this prompt</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const SourceIcon = SOURCE_TYPE_ICONS[provenance.sourceType];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SourceIcon className="h-5 w-5" />
          Provenance Information
        </CardTitle>
        <CardDescription>
          Complete tracking history for prompt {onChainId || promptId}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="transformations">Transformations</TabsTrigger>
            <TabsTrigger value="lineage">Lineage</TabsTrigger>
            <TabsTrigger value="derivatives">Derivatives</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            {/* Source Information */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Source</h3>
              <div className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Type</span>
                  <Badge variant="secondary">
                    {provenance.sourceType.replace(/_/g, " ")}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">System</span>
                  <span className="text-sm font-medium">
                    {provenance.sourceSystem.name} v{provenance.sourceSystem.version}
                  </span>
                </div>
                {provenance.sourceSystem.identifier && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Identifier</span>
                    <span className="text-sm font-mono text-xs">
                      {provenance.sourceSystem.identifier}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Import Batch */}
            {provenance.importBatch && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Import Batch</h3>
                <div className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Batch ID</span>
                    <span className="text-sm font-mono text-xs">
                      {provenance.importBatch.batchId}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Total Items</span>
                    <span className="text-sm font-medium">
                      {provenance.importBatch.totalItems}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Imported At</span>
                    <span className="text-sm">
                      {new Date(provenance.importBatch.importedAt).toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Actor Information */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Created By</h3>
              <div className="rounded-lg border p-3 space-y-2">
                {provenance.actor.walletAddress && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Wallet</span>
                    <span className="text-sm font-mono text-xs">
                      {provenance.actor.walletAddress.slice(0, 8)}...
                      {provenance.actor.walletAddress.slice(-6)}
                    </span>
                  </div>
                )}
                {provenance.actor.userId && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">User ID</span>
                    <span className="text-sm font-mono text-xs">
                      {provenance.actor.userId}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Timestamp</span>
                  <span className="text-sm">
                    {new Date(provenance.actor.timestamp).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="transformations" className="space-y-4">
            {provenance.transformations.length === 0 ? (
              <p className="text-sm text-muted-foreground">No transformations recorded</p>
            ) : (
              <div className="space-y-3">
                {provenance.transformations.map((transform, idx) => {
                  const TransformIcon = TRANSFORM_TYPE_ICONS[transform.transformType];
                  return (
                    <div key={idx} className="rounded-lg border p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <TransformIcon className="h-4 w-4" />
                        <Badge variant="outline">
                          {transform.transformType.replace(/_/g, " ")}
                        </Badge>
                        <span className="text-xs text-muted-foreground ml-auto">
                          {new Date(transform.timestamp).toLocaleString()}
                        </span>
                      </div>
                      {transform.details && (
                        <p className="text-sm text-muted-foreground">{transform.details}</p>
                      )}
                      {transform.actor.walletAddress && (
                        <p className="text-xs font-mono text-muted-foreground">
                          By: {transform.actor.walletAddress.slice(0, 8)}...
                          {transform.actor.walletAddress.slice(-6)}
                        </p>
                      )}
                      {idx < provenance.transformations.length - 1 && (
                        <Separator className="mt-2" />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="lineage" className="space-y-4">
            {!lineage ? (
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm text-muted-foreground">Loading lineage...</span>
              </div>
            ) : lineage.ancestors.length === 0 ? (
              <p className="text-sm text-muted-foreground">No ancestor prompts found</p>
            ) : (
              <div className="space-y-3">
                {lineage.ancestors.map((ancestor: any, idx: number) => (
                  <div key={idx} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">
                        {ancestor.title || `Prompt #${ancestor.promptId}`}
                      </span>
                      <Badge variant="secondary">{ancestor.kind}</Badge>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>Depth: {ancestor.depth}</span>
                      <span>Origin: {ancestor.origin}</span>
                      <span>Status: {ancestor.visibility}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="derivatives" className="space-y-4">
            {!derivatives ? (
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm text-muted-foreground">Loading derivatives...</span>
              </div>
            ) : derivatives.count === 0 ? (
              <p className="text-sm text-muted-foreground">No derivative prompts found</p>
            ) : (
              <div className="space-y-3">
                <p className="text-sm font-medium">
                  {derivatives.count} derivative{derivatives.count > 1 ? "s" : ""} found
                </p>
                {derivatives.derivatives.map((derivative: any, idx: number) => (
                  <div key={idx} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-mono text-xs">
                        {derivative.onChainId || derivative.promptId}
                      </span>
                      {derivative.relationKind && (
                        <Badge variant="secondary">{derivative.relationKind}</Badge>
                      )}
                    </div>
                    {derivative.createdAt && (
                      <span className="text-xs text-muted-foreground">
                        Created: {new Date(derivative.createdAt).toLocaleString()}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
