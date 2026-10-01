/**
 * Admin Provenance Dashboard (#929)
 * 
 * Features:
 * - View all imports and their status
 * - Filter by source type, batch ID, date range
 * - View detailed provenance for specific prompts
 * - Track import statistics
 * - View provenance flags and issues
 */

import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Archive,
  Bot,
  ChevronLeft,
  ChevronRight,
  Database,
  FileUp,
  Globe,
  Link2,
  Loader2,
  Package,
  RefreshCw,
  Shuffle,
  Upload,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ProvenanceViewer } from "@/components/admin/ProvenanceViewer";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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

interface ImportBatch {
  _id: string;
  batchId: string;
  sourceType: ImportSourceType;
  totalItems: number;
  successfulItems: number;
  failedItems: number;
  status: "pending" | "in_progress" | "completed" | "failed";
  importedBy: string;
  importedAt: string;
}

interface ProvenanceRecord {
  _id: string;
  promptId: string;
  onChainId?: string;
  sourceType: ImportSourceType;
  sourceSystem: {
    name: string;
    version: string;
  };
  importBatch?: {
    batchId: string;
  };
  createdAt: string;
}

interface ProvenanceStatistics {
  totalRecords: number;
  bySourceType: Record<ImportSourceType, number>;
  recentImports: number;
  totalBatches: number;
}

// ── API helpers ───────────────────────────────────────────────────────────────

function adminToken(): string {
  return localStorage.getItem("adminToken") ?? "";
}

function authHeaders(): HeadersInit {
  return { "Content-Type": "application/json", Authorization: `Bearer ${adminToken()}` };
}

async function fetchBulkImports(): Promise<ImportBatch[]> {
  const res = await fetch("/api/provenance/bulk-imports", { headers: authHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch imports: ${res.status}`);
  const data = await res.json();
  return data.imports || [];
}

async function fetchStatistics(): Promise<ProvenanceStatistics> {
  const res = await fetch("/api/provenance/statistics", { headers: authHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch statistics: ${res.status}`);
  return res.json();
}

async function fetchProvenanceQuery(filters: {
  sourceType?: string;
  batchId?: string;
  since?: string;
  until?: string;
}) {
  const res = await fetch("/api/provenance/query", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(filters),
  });
  if (!res.ok) throw new Error(`Failed to query provenance: ${res.status}`);
  return res.json();
}

// ── Icon mapping ──────────────────────────────────────────────────────────────

const SOURCE_TYPE_ICONS: Record<ImportSourceType, React.ComponentType<any>> = {
  manual: User,
  api: Globe,
  file_upload: FileUp,
  migration: Archive,
  external_api: Database,
  fork: Shuffle,
  template: Package,
  ai_generated: Bot,
  system: Link2,
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function ProvenanceDashboard() {
  const queryClient = useQueryClient();
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    sourceType: "",
    batchId: "",
    since: "",
    until: "",
  });

  const { data: imports, isLoading: importsLoading, error: importsError } = useQuery({
    queryKey: ["bulk-imports"],
    queryFn: fetchBulkImports,
  });

  const { data: statistics, isLoading: statsLoading } = useQuery({
    queryKey: ["provenance-statistics"],
    queryFn: fetchStatistics,
  });

  const { data: queryResults, isLoading: queryLoading, refetch: refetchQuery } = useQuery({
    queryKey: ["provenance-query", filters],
    queryFn: () => fetchProvenanceQuery(filters),
    enabled: false,
  });

  const handleSearch = useCallback(() => {
    refetchQuery();
  }, [refetchQuery]);

  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["bulk-imports"] });
    queryClient.invalidateQueries({ queryKey: ["provenance-statistics"] });
  }, [queryClient]);

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Provenance Dashboard</h1>
          <p className="text-muted-foreground">
            Monitor and manage prompt provenance tracking
          </p>
        </div>
        <Button onClick={handleRefresh} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="imports">Imports</TabsTrigger>
          <TabsTrigger value="search">Search</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          {statsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : statistics ? (
            <>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">Total Records</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{statistics.totalRecords}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">Total Batches</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{statistics.totalBatches}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">Recent Imports</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{statistics.recentImports}</div>
                    <p className="text-xs text-muted-foreground">Last 30 days</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">Source Types</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {Object.keys(statistics.bySourceType).length}
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Records by Source Type</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {Object.entries(statistics.bySourceType).map(([type, count]) => {
                      const Icon = SOURCE_TYPE_ICONS[type as ImportSourceType];
                      return (
                        <div key={type} className="flex items-center justify-between p-2 rounded-lg border">
                          <div className="flex items-center gap-2">
                            <Icon className="h-4 w-4" />
                            <span className="text-sm font-medium">
                              {type.replace(/_/g, " ")}
                            </span>
                          </div>
                          <Badge variant="secondary">{count}</Badge>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <AlertCircle className="h-5 w-5" />
                  <p>No statistics available</p>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Imports Tab */}
        <TabsContent value="imports" className="space-y-4">
          {importsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : importsError ? (
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-destructive">
                  <AlertCircle className="h-5 w-5" />
                  <p>Failed to load imports</p>
                </div>
              </CardContent>
            </Card>
          ) : !imports || imports.length === 0 ? (
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <AlertCircle className="h-5 w-5" />
                  <p>No bulk imports found</p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {imports.map((batch) => {
                const Icon = SOURCE_TYPE_ICONS[batch.sourceType];
                return (
                  <Card key={batch._id}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Icon className="h-5 w-5" />
                          <CardTitle className="text-base">
                            Batch {batch.batchId}
                          </CardTitle>
                        </div>
                        <Badge
                          variant={
                            batch.status === "completed"
                              ? "default"
                              : batch.status === "failed"
                              ? "destructive"
                              : "secondary"
                          }
                        >
                          {batch.status}
                        </Badge>
                      </div>
                      <CardDescription>
                        {batch.sourceType.replace(/_/g, " ")} •{" "}
                        {new Date(batch.importedAt).toLocaleString()}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div>
                          <p className="text-muted-foreground">Total</p>
                          <p className="font-medium">{batch.totalItems}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Success</p>
                          <p className="font-medium text-green-600">{batch.successfulItems}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Failed</p>
                          <p className="font-medium text-red-600">{batch.failedItems}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* Search Tab */}
        <TabsContent value="search" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Search Provenance Records</CardTitle>
              <CardDescription>
                Filter and search through provenance records
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Source Type</Label>
                  <Select
                    value={filters.sourceType}
                    onValueChange={(value) =>
                      setFilters((prev) => ({ ...prev, sourceType: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All sources" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">All sources</SelectItem>
                      <SelectItem value="API_IMPORT">API Import</SelectItem>
                      <SelectItem value="MANUAL_ENTRY">Manual Entry</SelectItem>
                      <SelectItem value="FILE_UPLOAD">File Upload</SelectItem>
                      <SelectItem value="EXTERNAL_SYSTEM">External System</SelectItem>
                      <SelectItem value="BULK_IMPORT">Bulk Import</SelectItem>
                      <SelectItem value="BLOCKCHAIN">Blockchain</SelectItem>
                      <SelectItem value="AI_GENERATION">AI Generation</SelectItem>
                      <SelectItem value="MIGRATION">Migration</SelectItem>
                      <SelectItem value="SCRAPING">Scraping</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Batch ID</Label>
                  <Input
                    placeholder="Enter batch ID..."
                    value={filters.batchId}
                    onChange={(e) =>
                      setFilters((prev) => ({ ...prev, batchId: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>From Date</Label>
                  <Input
                    type="date"
                    value={filters.since}
                    onChange={(e) =>
                      setFilters((prev) => ({ ...prev, since: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>To Date</Label>
                  <Input
                    type="date"
                    value={filters.until}
                    onChange={(e) =>
                      setFilters((prev) => ({ ...prev, until: e.target.value }))
                    }
                  />
                </div>
              </div>
              <Button onClick={handleSearch} disabled={queryLoading}>
                {queryLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Search
              </Button>
            </CardContent>
          </Card>

          {queryResults && (
            <Card>
              <CardHeader>
                <CardTitle>Search Results</CardTitle>
                <CardDescription>
                  Found {queryResults.length || 0} record(s)
                </CardDescription>
              </CardHeader>
              <CardContent>
                {queryResults.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No results found</p>
                ) : (
                  <div className="space-y-2">
                    {queryResults.map((record: ProvenanceRecord) => {
                      const Icon = SOURCE_TYPE_ICONS[record.sourceType];
                      return (
                        <div
                          key={record._id}
                          className="flex items-center justify-between p-3 rounded-lg border hover:bg-accent cursor-pointer"
                          onClick={() => setSelectedPromptId(record.promptId)}
                        >
                          <div className="flex items-center gap-3">
                            <Icon className="h-4 w-4" />
                            <div>
                              <p className="text-sm font-medium">
                                Prompt {record.onChainId || record.promptId}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {record.sourceSystem.name} •{" "}
                                {new Date(record.createdAt).toLocaleDateString()}
                              </p>
                            </div>
                          </div>
                          <Badge variant="secondary">
                            {record.sourceType.replace(/_/g, " ")}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Provenance Detail Dialog */}
      <Dialog open={!!selectedPromptId} onOpenChange={(open) => !open && setSelectedPromptId(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Prompt Provenance Details</DialogTitle>
            <DialogDescription>
              Complete provenance information for prompt {selectedPromptId}
            </DialogDescription>
          </DialogHeader>
          {selectedPromptId && (
            <ProvenanceViewer promptId={selectedPromptId} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
