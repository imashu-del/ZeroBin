import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Trash2, HardDrive, ShieldAlert, CheckCircle, Loader2, Lightbulb, Clock, ChevronDown, ChevronUp, MoreHorizontal, Search as SearchIcon, X, ShieldCheck, Archive, FilePlus, FolderPlus } from "lucide-react";

interface FoundItem {
  path: string;
  size_bytes: number;
  rule_name: string;
  category: string;
  safe_to_delete: boolean;
  risk: string;
  description: string;
  impact: string;
}

interface SearchResult {
  path: string;
  size_bytes: number;
}

interface Recommendation {
  id: string;
  target: string;
  description: string;
  size_bytes: number;
  rule_type: string;
  action: string;
  inactive_days: number;
}

interface ScanResultPayload {
  caches: FoundItem[];
  recommendations: Recommendation[];
}

function formatBytes(bytes: number, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function App() {
  const [isScanning, setIsScanning] = useState(false);
  const [results, setResults] = useState<ScanResultPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCleaning, setIsCleaning] = useState<string | null>(null);
  const [isRecExpanded, setIsRecExpanded] = useState(false);
  const [ignoredIds, setIgnoredIds] = useState<Set<string>>(new Set());
  const [safeDelete, setSafeDelete] = useState(false);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [drives, setDrives] = useState<string[]>([]);
  const [selectedDrive, setSelectedDrive] = useState<string>("");

  // Backup state
  const [isBackupOpen, setIsBackupOpen] = useState(false);
  const [backupSources, setBackupSources] = useState<string[]>([]);
  const [backupDest, setBackupDest] = useState<string | null>(null);
  const [isCompressing, setIsCompressing] = useState(false);
  const [compressResult, setCompressResult] = useState<string | null>(null);

  useEffect(() => {
    invoke("get_drives")
      .then((res: any) => setDrives(res))
      .catch(console.error);
  }, []);

  function handleIgnore(id: string) {
    setIgnoredIds(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  async function handleCleanUp(path: string, fromSearch = false) {
    setIsCleaning(path);
    setError(null);
    try {
      await invoke("clean_up_path", { path, safeDelete });
      if (results && !fromSearch) {
        setResults({
          ...results,
          caches: results.caches.filter(c => c.path !== path)
        });
      }
      if (fromSearch) {
        setSearchResults(searchResults.filter(r => r.path !== path));
      }
    } catch (e: any) {
      setError(`Failed to clean up: ${e.toString()}`);
    } finally {
      setIsCleaning(null);
    }
  }

  async function startScan() {
    setIsScanning(true);
    setError(null);
    setIgnoredIds(new Set());
    try {
      const payload: ScanResultPayload = await invoke("start_scan", { targetPath: selectedDrive });
      
      // Sort by size descending
      payload.caches.sort((a, b) => b.size_bytes - a.size_bytes);
      payload.recommendations.sort((a, b) => b.size_bytes - a.size_bytes);
      
      setResults(payload);
    } catch (e: any) {
      setError(e.toString());
    } finally {
      setIsScanning(false);
    }
  }

  async function performSearch() {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const res: SearchResult[] = await invoke("search_files", { query: searchQuery });
      setSearchResults(res);
    } catch (e: any) {
      console.error(e);
    } finally {
      setIsSearching(false);
    }
  }

  async function selectBackupSource(directory: boolean) {
    try {
      const selected = await open({ directory, multiple: true });
      if (selected) {
        if (Array.isArray(selected)) {
          setBackupSources(prev => Array.from(new Set([...prev, ...selected])));
        } else {
          setBackupSources(prev => Array.from(new Set([...prev, selected as string])));
        }
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function selectBackupDest() {
    try {
      const selected = await save({
        filters: [{ name: "7-Zip Archive", extensions: ["7z"] }],
        defaultPath: "ZeroBin_Backup.7z"
      });
      if (selected) {
        setBackupDest(selected);
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function startBackup() {
    if (!backupDest || backupSources.length === 0) return;
    setIsCompressing(true);
    setCompressResult(null);
    try {
      const result = await invoke("compress_and_backup", { 
        sourcePaths: backupSources, 
        destination: backupDest 
      });
      setCompressResult(`Success: ${result}`);
      // Clear after success
      setBackupSources([]);
      setBackupDest(null);
    } catch (e: any) {
      setCompressResult(`Error: ${e}`);
    } finally {
      setIsCompressing(false);
    }
  }

  const visibleCaches = results ? results.caches.filter(c => !ignoredIds.has(c.path)) : [];
  const visibleRecommendations = results ? results.recommendations.filter(r => !ignoredIds.has(r.id)) : [];

  const totalCacheSize = visibleCaches.reduce((acc, item) => acc + item.size_bytes, 0);
  const totalRecSize = visibleRecommendations.reduce((acc, item) => acc + item.size_bytes, 0);
  const totalSavings = totalCacheSize + totalRecSize;

  return (
    <main className="flex min-h-screen flex-col items-center p-8 bg-background text-foreground">
      <div className="flex flex-col items-center space-y-4 mb-8">
        <div className="flex items-center justify-center">
          <h1 className="text-5xl tracking-tight" style={{ fontFamily: '"Clash Display Light", "Clash Display", sans-serif', fontWeight: 300 }}>ZeroBin</h1>
        </div>
        <p className="text-muted-foreground max-w-md text-center">
          Offline-first storage intelligence and cleanup utility.
        </p>
      </div>

      <div className="fixed bottom-6 left-6 z-50 flex flex-col justify-end">
        {isMoreOpen && (
          <div 
            className="fixed inset-0 z-40" 
            onClick={() => setIsMoreOpen(false)}
          />
        )}
        <div className="relative z-50">
          {isMoreOpen && (
            <div className="absolute bottom-full left-0 mb-3 bg-card border shadow-xl rounded-xl w-64 overflow-hidden animate-in fade-in slide-in-from-bottom-2">
              <div className="p-2">
                <button 
                  onClick={() => {
                    setIsSearchOpen(true);
                    setIsMoreOpen(false);
                  }}
                  className="w-full text-left px-4 py-2 hover:bg-muted rounded-md flex items-center"
                >
                  <SearchIcon className="w-4 h-4 mr-2" /> Search Files
                </button>
                <button 
                  onClick={() => {
                    setIsBackupOpen(true);
                    setIsMoreOpen(false);
                  }}
                  className="w-full text-left px-4 py-2 hover:bg-muted rounded-md flex items-center"
                >
                  <Archive className="w-4 h-4 mr-2" /> Compress & Backup
                </button>
                <div className="flex items-center justify-between px-4 py-2 hover:bg-muted rounded-md cursor-pointer" onClick={() => setSafeDelete(!safeDelete)}>
                  <div className="flex items-center">
                    <ShieldCheck className={`w-4 h-4 mr-2 ${safeDelete ? "text-green-500" : "text-muted-foreground"}`} />
                    <span>Safe Delete</span>
                  </div>
                  <div className={`w-8 h-4 rounded-full flex items-center px-0.5 transition-colors ${safeDelete ? 'bg-green-500' : 'bg-muted-foreground/30'}`}>
                    <div className={`w-3 h-3 rounded-full bg-white transition-transform ${safeDelete ? 'translate-x-4' : 'translate-x-0'}`} />
                  </div>
                </div>
              </div>
            </div>
          )}
          
          <button 
            onClick={() => setIsMoreOpen(!isMoreOpen)}
            className="flex items-center px-5 py-2.5 bg-card border shadow-md rounded-full hover:bg-muted transition font-medium"
          >
            {isMoreOpen ? <X className="w-5 h-5 mr-2 text-muted-foreground" /> : <MoreHorizontal className="w-5 h-5 mr-2 text-muted-foreground" />}
            {isMoreOpen ? "Close" : "More"}
          </button>
        </div>
      </div>

      <div className="w-full max-w-4xl flex flex-col space-y-6">
        <div className="flex justify-between items-center bg-card p-6 rounded-xl border shadow-sm">
          <div>
            <h2 className="text-2xl font-semibold flex items-center">
              <HardDrive className="mr-2" /> Storage Scanner
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Find caches and review smart storage recommendations.
            </p>
          </div>
          <div className="flex items-center space-x-3">
            {drives.length > 0 && (
              <select 
                value={selectedDrive} 
                onChange={e => setSelectedDrive(e.target.value)}
                className="px-4 py-3 bg-muted border border-muted-foreground/20 rounded-lg outline-none cursor-pointer focus:border-primary transition"
              >
                <option value="">User Home Directory</option>
                {drives.map(d => (
                  <option key={d} value={d}>{d} Drive</option>
                ))}
              </select>
            )}
            <button 
              onClick={startScan}
              disabled={isScanning}
              className="px-6 py-3 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition flex items-center disabled:opacity-50"
            >
              {isScanning ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" /> Scanning...
                </>
              ) : "Start Scan"}
            </button>
          </div>
        </div>

        {error && (
          <div className="p-4 bg-destructive/10 text-destructive border border-destructive/20 rounded-lg">
            Error: {error}
          </div>
        )}

        {results && !isScanning && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            
            <div className="flex justify-between items-end border-b pb-4">
              <h3 className="text-xl font-medium">Total Potential Savings</h3>
              <p className="text-3xl font-bold text-primary">{formatBytes(totalSavings)}</p>
            </div>

            {/* Recommendations Section */}
            <div className="mb-8">
              <button 
                onClick={() => setIsRecExpanded(!isRecExpanded)}
                className="w-full flex items-center justify-between text-xl font-medium mb-4 text-purple-400 bg-card p-4 rounded-xl border hover:bg-muted/50 transition"
              >
                <div className="flex items-center">
                  <Lightbulb className="mr-2" /> 
                  Smart Recommendations
                  {visibleRecommendations.length > 0 && (
                    <span className="ml-3 text-sm bg-purple-500/20 text-purple-400 px-3 py-1 rounded-full font-bold">
                      {visibleRecommendations.length} items
                    </span>
                  )}
                </div>
                {isRecExpanded ? <ChevronUp /> : <ChevronDown />}
              </button>
              
              {isRecExpanded && (
                visibleRecommendations.length === 0 ? (
                  <div className="text-center p-6 text-muted-foreground bg-card rounded-xl border">
                    No smart recommendations right now.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {visibleRecommendations.map((rec, idx) => (
                      <div key={`rec-${idx}`} className="bg-card p-5 rounded-xl border border-purple-500/20 shadow-sm hover:border-purple-500/50 transition relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-1 h-full bg-purple-500"></div>
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex items-center space-x-2">
                            <h4 className="text-lg font-semibold">{rec.target}</h4>
                          </div>
                          <span className="text-lg font-bold text-purple-400">{formatBytes(rec.size_bytes)}</span>
                        </div>
                        
                        <p className="text-sm text-muted-foreground mb-3">{rec.description}</p>
                        
                        <div className="flex items-center text-sm text-amber-500 bg-amber-500/10 w-fit px-3 py-1.5 rounded-full mb-4">
                          <Clock className="w-4 h-4 mr-2" />
                          Unused for {rec.inactive_days} days
                        </div>
                        
                        <div className="flex justify-end space-x-3">
                          <button 
                            onClick={() => handleIgnore(rec.id)}
                            className="px-4 py-2 border rounded-md text-sm hover:bg-muted transition text-muted-foreground hover:text-foreground"
                          >
                            Ignore
                          </button>
                          <button className="px-4 py-2 border rounded-md text-sm hover:bg-muted transition">
                            View Details
                          </button>
                          <button className="px-4 py-2 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-md text-sm hover:bg-purple-500 hover:text-white transition">
                            Review Action
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>

            {/* Standard Caches Section */}
            <div>
              <h3 className="text-xl font-medium mb-4">Known Caches & Temp Files</h3>
              {visibleCaches.length === 0 ? (
                <div className="text-center p-8 text-muted-foreground bg-card rounded-xl border">
                  Your system is clean!
                </div>
              ) : (
                <div className="space-y-4">
                  {visibleCaches.map((item, idx) => (
                    <div key={`cache-${idx}`} className="bg-card p-5 rounded-xl border shadow-sm hover:border-primary/50 transition">
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center space-x-2">
                          {item.safe_to_delete ? (
                            <CheckCircle className="w-5 h-5 text-green-500" />
                          ) : (
                            <ShieldAlert className="w-5 h-5 text-amber-500" />
                          )}
                          <h4 className="text-lg font-semibold">{item.rule_name}</h4>
                        </div>
                        <span className="text-lg font-bold">{formatBytes(item.size_bytes)}</span>
                      </div>
                      
                      <p className="text-sm text-muted-foreground mb-3">{item.description}</p>
                      
                      <div className="grid grid-cols-2 gap-4 text-sm bg-muted/50 p-3 rounded-lg mb-4">
                        <div>
                          <span className="font-semibold block mb-1">Path</span>
                          <code className="text-xs break-all text-muted-foreground">{item.path}</code>
                        </div>
                        <div>
                          <span className="font-semibold block mb-1">Expected Impact</span>
                          <p className="text-muted-foreground">{item.impact}</p>
                        </div>
                      </div>
                      
                      <div className="flex justify-end space-x-3">
                        <button 
                          onClick={() => handleIgnore(item.path)}
                          className="px-4 py-2 border rounded-md text-sm hover:bg-muted transition text-muted-foreground hover:text-foreground"
                        >
                          Ignore
                        </button>
                        <button 
                          onClick={() => invoke("open_path_in_explorer", { path: item.path })}
                          className="px-4 py-2 border rounded-md text-sm hover:bg-muted transition"
                        >
                          View Files
                        </button>
                        <button 
                          onClick={() => handleCleanUp(item.path)}
                          disabled={isCleaning === item.path}
                          className="px-4 py-2 bg-destructive/10 text-destructive border border-destructive/20 rounded-md text-sm hover:bg-destructive hover:text-destructive-foreground transition flex items-center disabled:opacity-50"
                        >
                          {isCleaning === item.path ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                          {isCleaning === item.path ? "Cleaning..." : "Clean Up"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            
          </div>
        )}
      </div>

      {isSearchOpen && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex flex-col items-center pt-24 px-4 animate-in fade-in">
          <div className="w-full max-w-3xl bg-card border shadow-2xl rounded-2xl overflow-hidden flex flex-col max-h-[80vh]">
            <div className="p-4 border-b flex items-center space-x-4 relative">
              <SearchIcon className="w-6 h-6 text-muted-foreground ml-2" />
              <input 
                autoFocus
                type="text"
                placeholder="Search for massive files..."
                className="flex-1 bg-transparent text-xl outline-none"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && performSearch()}
              />
              {isSearching && <Loader2 className="w-5 h-5 animate-spin text-primary" />}
              <button 
                onClick={() => setIsSearchOpen(false)} 
                className="p-2 hover:bg-muted rounded-full absolute right-2"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="overflow-y-auto p-4 flex-1">
              {searchResults.length === 0 ? (
                <div className="text-center p-12 text-muted-foreground">
                  Press Enter to search your entire home directory.
                </div>
              ) : (
                <div className="space-y-3">
                  {searchResults.map((res, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg hover:bg-muted/50 transition">
                      <div className="overflow-hidden mr-4">
                        <div className="truncate font-medium text-sm" title={res.path}>
                          {res.path.split('\\').pop() || res.path.split('/').pop()}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {res.path}
                        </div>
                      </div>
                      <div className="flex items-center space-x-4 shrink-0">
                        <span className="font-bold text-sm">{formatBytes(res.size_bytes)}</span>
                        <button 
                          onClick={() => handleCleanUp(res.path, true)}
                          disabled={isCleaning === res.path}
                          className="px-3 py-1.5 bg-destructive/10 text-destructive border border-destructive/20 rounded-md text-xs hover:bg-destructive hover:text-destructive-foreground transition flex items-center disabled:opacity-50"
                        >
                          {isCleaning === res.path ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : "Clean Up"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Backup & Compress Modal */}
      {isBackupOpen && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
          <div className="w-full max-w-2xl bg-card border shadow-2xl rounded-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-6 border-b flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <Archive className="w-6 h-6 text-primary" />
                <h2 className="text-2xl font-bold">Cold Storage Backup</h2>
              </div>
              <button onClick={() => setIsBackupOpen(false)} className="p-2 hover:bg-muted rounded-full">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto space-y-6 flex-1">
              <p className="text-muted-foreground text-sm">
                Aggressively compress your stale files and folders using the ultra-efficient 7-Zip LZMA2 engine to free up space on your primary drive.
              </p>

              <div className="space-y-3">
                <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">1. Select Sources</h3>
                <div className="flex space-x-3">
                  <button onClick={() => selectBackupSource(false)} className="flex-1 py-2 px-4 border border-dashed hover:border-primary/50 hover:bg-muted/50 rounded-lg flex items-center justify-center transition">
                    <FilePlus className="w-4 h-4 mr-2" /> Add Files
                  </button>
                  <button onClick={() => selectBackupSource(true)} className="flex-1 py-2 px-4 border border-dashed hover:border-primary/50 hover:bg-muted/50 rounded-lg flex items-center justify-center transition">
                    <FolderPlus className="w-4 h-4 mr-2" /> Add Folders
                  </button>
                </div>
                {backupSources.length > 0 && (
                  <div className="bg-muted/30 rounded-lg p-3 max-h-40 overflow-y-auto border space-y-2">
                    {backupSources.map((src, i) => (
                      <div key={i} className="flex items-center justify-between text-sm bg-background p-2 rounded border">
                        <span className="truncate mr-4" title={src}>{src}</span>
                        <button onClick={() => setBackupSources(backupSources.filter(s => s !== src))} className="text-destructive hover:text-destructive/80">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">2. Select Destination</h3>
                <button onClick={selectBackupDest} className="w-full py-3 px-4 bg-muted hover:bg-muted/80 rounded-lg flex items-center justify-between transition border border-transparent hover:border-primary/20">
                  <span className="truncate mr-4 font-medium">{backupDest || "Choose where to save the .7z archive..."}</span>
                  <HardDrive className="w-5 h-5 text-muted-foreground shrink-0" />
                </button>
              </div>

              {compressResult && (
                <div className={`p-4 rounded-lg text-sm border ${compressResult.startsWith('Success') ? 'bg-green-500/10 text-green-600 border-green-500/20' : 'bg-destructive/10 text-destructive border-destructive/20'}`}>
                  {compressResult}
                </div>
              )}
            </div>

            <div className="p-6 border-t bg-muted/20 flex justify-end">
              <button 
                onClick={startBackup}
                disabled={isCompressing || backupSources.length === 0 || !backupDest}
                className="px-6 py-3 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition flex items-center disabled:opacity-50"
              >
                {isCompressing ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Archive className="w-5 h-5 mr-2" />}
                {isCompressing ? "Compressing & Backing Up..." : "Start Compression"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
