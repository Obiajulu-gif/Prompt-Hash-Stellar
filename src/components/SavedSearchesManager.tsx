import { useState } from "react";
import { Bookmark, Bell, BellOff, Trash2, Edit2, Check, X, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSavedSearches, SavedSearch, SavedSearchFilter } from "@/hooks/useSavedSearches";

interface SavedSearchesManagerProps {
  currentFilter: SavedSearchFilter;
  onApplyFilter: (_filter: SavedSearchFilter) => void;
  isOpen: boolean;
  onClose: () => void;
}

export function SavedSearchesManager({
  currentFilter,
  onApplyFilter,
  isOpen,
  onClose,
}: SavedSearchesManagerProps) {
  const {
    savedSearches,
    alerts,
    unreadAlertCount,
    saveSearch,
    renameSearch,
    toggleAlerts,
    deleteSearch,
    markAlertRead,
    clearAlerts,
  } = useSavedSearches();

  const [activeTab, setActiveTab] = useState<"searches" | "alerts">("searches");
  const [newSearchName, setNewSearchName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  if (!isOpen) return null;

  const handleSaveCurrent = (e: React.FormEvent) => {
    e.preventDefault();
    const defaultName = newSearchName.trim() || `Search: ${currentFilter.category || "All"} (${currentFilter.priceRange[0]}-${currentFilter.priceRange[1]} XLM)`;
    saveSearch(defaultName, currentFilter, true);
    setNewSearchName("");
  };

  const handleStartRename = (search: SavedSearch) => {
    setEditingId(search.id);
    setEditingName(search.name);
  };

  const handleConfirmRename = (id: string) => {
    if (editingName.trim()) {
      renameSearch(id, editingName.trim());
    }
    setEditingId(null);
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-white/10 rounded-2xl p-6 shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <Bookmark className="h-5 w-5 text-emerald-400" />
            <h2 className="text-xl font-bold text-white">Saved Searches & Alerts</h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="text-slate-400 hover:text-white rounded-full h-8 w-8"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Tab switcher */}
        <div className="flex border-b border-white/10 my-4">
          <button
            onClick={() => setActiveTab("searches")}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === "searches"
                ? "border-emerald-500 text-emerald-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Bookmark className="h-4 w-4" />
            Saved Searches ({savedSearches.length})
          </button>
          <button
            onClick={() => setActiveTab("alerts")}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold border-b-2 transition-colors relative ${
              activeTab === "alerts"
                ? "border-emerald-500 text-emerald-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Bell className="h-4 w-4" />
            In-App Alerts ({alerts.length})
            {unreadAlertCount > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-emerald-500 text-slate-950 font-bold">
                {unreadAlertCount}
              </span>
            )}
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === "searches" ? (
          <div className="flex-1 overflow-y-auto space-y-6 pr-1">
            {/* Form to save current active filter */}
            <form onSubmit={handleSaveCurrent} className="bg-slate-950/60 p-4 rounded-xl border border-white/5 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Save Current Search</p>
              <div className="text-xs text-slate-400 flex flex-wrap gap-2">
                {currentFilter.searchQuery && <span className="bg-white/10 px-2 py-0.5 rounded">Query: "{currentFilter.searchQuery}"</span>}
                {currentFilter.category && <span className="bg-white/10 px-2 py-0.5 rounded">Category: {currentFilter.category}</span>}
                <span className="bg-white/10 px-2 py-0.5 rounded">Price: {currentFilter.priceRange[0]}-{currentFilter.priceRange[1]} XLM</span>
                {currentFilter.sortBy && <span className="bg-white/10 px-2 py-0.5 rounded">Sort: {currentFilter.sortBy}</span>}
              </div>
              <div className="flex gap-2">
                <Input
                  value={newSearchName}
                  onChange={(e) => setNewSearchName(e.target.value)}
                  placeholder="Custom name (optional)..."
                  className="bg-slate-900 border-white/10 h-10 text-sm"
                />
                <Button type="submit" className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold h-10 px-4 shrink-0">
                  Save Search
                </Button>
              </div>
            </form>

            {/* List of saved searches */}
            {savedSearches.length === 0 ? (
              <div className="text-center py-10 text-slate-500">
                <Bookmark className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p>No saved searches yet.</p>
                <p className="text-xs text-slate-600 mt-1">Set filters on the browse page and click Save Search above.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {savedSearches.map((search) => (
                  <div
                    key={search.id}
                    className="p-4 rounded-xl border border-white/10 bg-slate-950/40 flex flex-col md:flex-row md:items-center justify-between gap-4"
                  >
                    <div className="flex-1 space-y-1">
                      {editingId === search.id ? (
                        <div className="flex items-center gap-2">
                          <Input
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            className="bg-slate-900 border-emerald-500 h-8 text-sm"
                            autoFocus
                          />
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-emerald-400 hover:text-emerald-300"
                            onClick={() => handleConfirmRename(search.id)}
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-slate-400 hover:text-slate-200"
                            onClick={() => setEditingId(null)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <h4 className="font-semibold text-white text-base">{search.name}</h4>
                          <button
                            onClick={() => handleStartRename(search)}
                            className="text-slate-500 hover:text-slate-300"
                            title="Rename search"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                      <div className="text-xs text-slate-400 flex flex-wrap gap-x-3 gap-y-1">
                        <span>Cat: {search.filter.category || "All"}</span>
                        <span>Price: {search.filter.priceRange[0]}–{search.filter.priceRange[1]} XLM</span>
                        {search.filter.searchQuery && <span>Text: "{search.filter.searchQuery}"</span>}
                        {search.filter.sortBy && <span>Sort: {search.filter.sortBy}</span>}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        onClick={() => {
                          onApplyFilter(search.filter);
                          onClose();
                        }}
                        className="bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30 gap-1 text-xs"
                      >
                        <Play className="h-3.5 w-3.5 fill-emerald-400" />
                        Run Search
                      </Button>

                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => toggleAlerts(search.id)}
                        className={`h-9 w-9 border ${
                          search.alertsEnabled
                            ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
                            : "border-white/10 text-slate-500 bg-white/5"
                        }`}
                        title={search.alertsEnabled ? "In-app alerts enabled (click to disable)" : "In-app alerts disabled (click to enable)"}
                      >
                        {search.alertsEnabled ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
                      </Button>

                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => deleteSearch(search.id)}
                        className="h-9 w-9 text-red-400 hover:text-red-300 hover:bg-red-950/30 border border-white/5"
                        title="Delete saved search"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-4 pr-1">
            <div className="flex items-center justify-between text-xs text-slate-400 pb-2">
              <span>Matching listing alerts based on your saved searches</span>
              {alerts.length > 0 && (
                <button onClick={clearAlerts} className="text-red-400 hover:underline">
                  Clear all alerts
                </button>
              )}
            </div>

            {alerts.length === 0 ? (
              <div className="text-center py-10 text-slate-500">
                <Bell className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p>No matching listing alerts yet.</p>
                <p className="text-xs text-slate-600 mt-1">Alerts are generated when new prompts match your saved searches with alerts enabled.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {alerts.map((alert) => (
                  <div
                    key={alert.id}
                    className={`p-4 rounded-xl border flex items-center justify-between gap-4 transition-colors ${
                      alert.read
                        ? "bg-slate-950/30 border-white/5 opacity-75"
                        : "bg-emerald-950/20 border-emerald-500/30"
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                          {alert.savedSearchName}
                        </span>
                        <span className="text-xs text-slate-400">
                          {new Date(alert.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <h4 className="font-bold text-white text-base">{alert.listingTitle}</h4>
                      <p className="text-xs text-slate-400">
                        Category: {alert.listingCategory || "General"} • Price: {alert.listingPrice} XLM
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {!alert.read && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => markAlertRead(alert.id)}
                          className="text-xs text-slate-300 hover:text-white"
                        >
                          Mark Read
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
