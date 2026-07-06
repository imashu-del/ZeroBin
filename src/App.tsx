import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Trash2, HardDrive, ShieldAlert, CheckCircle, Loader2, Lightbulb, Clock } from "lucide-react";

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

  async function handleCleanUp(path: string) {
    setIsCleaning(path);
    setError(null);
    try {
      await invoke("clean_up_path", { path });
      if (results) {
        setResults({
          ...results,
          caches: results.caches.filter(c => c.path !== path)
        });
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
    try {
      const payload: ScanResultPayload = await invoke("start_scan");
      
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

  const totalCacheSize = results ? results.caches.reduce((acc, item) => acc + item.size_bytes, 0) : 0;
  const totalRecSize = results ? results.recommendations.reduce((acc, item) => acc + item.size_bytes, 0) : 0;
  const totalSavings = totalCacheSize + totalRecSize;

  return (
    <main className="flex min-h-screen flex-col items-center p-8 bg-background text-foreground">
      <div className="flex flex-col items-center space-y-4 mb-8">
        <div className="flex items-center space-x-3">
          <Trash2 className="w-12 h-12 text-primary" />
          <h1 className="text-4xl font-bold tracking-tight">ZeroBin</h1>
        </div>
        <p className="text-muted-foreground max-w-md text-center">
          Offline-first storage intelligence and cleanup utility.
        </p>
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
            <div>
              <h3 className="text-xl font-medium flex items-center mb-4 text-purple-400">
                <Lightbulb className="mr-2" /> Smart Recommendations
              </h3>
              {results.recommendations.length === 0 ? (
                <div className="text-center p-6 text-muted-foreground bg-card rounded-xl border">
                  No smart recommendations right now.
                </div>
              ) : (
                <div className="space-y-4">
                  {results.recommendations.map((rec, idx) => (
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
              )}
            </div>

            {/* Standard Caches Section */}
            <div>
              <h3 className="text-xl font-medium mb-4">Known Caches & Temp Files</h3>
              {results.caches.length === 0 ? (
                <div className="text-center p-8 text-muted-foreground bg-card rounded-xl border">
                  Your system is clean!
                </div>
              ) : (
                <div className="space-y-4">
                  {results.caches.map((item, idx) => (
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
    </main>
  );
}

export default App;
