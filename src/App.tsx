import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Trash2, HardDrive, ShieldAlert, CheckCircle, Loader2 } from "lucide-react";

interface FoundItem {
  path: String;
  size_bytes: number;
  rule_name: String;
  category: String;
  safe_to_delete: boolean;
  risk: String;
  description: String;
  impact: String;
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
  const [results, setResults] = useState<FoundItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startScan() {
    setIsScanning(true);
    setError(null);
    try {
      const items: FoundItem[] = await invoke("start_scan");
      // Sort by size descending
      items.sort((a, b) => b.size_bytes - a.size_bytes);
      setResults(items);
    } catch (e: any) {
      setError(e.toString());
    } finally {
      setIsScanning(false);
    }
  }

  const totalSize = results ? results.reduce((acc, item) => acc + item.size_bytes, 0) : 0;

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
              Find and safely remove large caches and temporary files.
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
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex justify-between items-end mb-4">
              <h3 className="text-xl font-medium">Scan Results</h3>
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Potential Savings</p>
                <p className="text-2xl font-bold text-primary">{formatBytes(totalSize)}</p>
              </div>
            </div>

            {results.length === 0 ? (
              <div className="text-center p-8 text-muted-foreground bg-card rounded-xl border">
                No removable items found. Your system is clean!
              </div>
            ) : (
              <div className="space-y-4">
                {results.map((item, idx) => (
                  <div key={idx} className="bg-card p-5 rounded-xl border shadow-sm hover:border-primary/50 transition">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center space-x-2">
                        {item.safe_to_delete ? (
                          <CheckCircle className="w-5 h-5 text-green-500" />
                        ) : (
                          <ShieldAlert className="w-5 h-5 text-yellow-500" />
                        )}
                        <h4 className="text-lg font-semibold">{item.rule_name}</h4>
                      </div>
                      <span className="text-lg font-bold">{formatBytes(item.size_bytes)}</span>
                    </div>
                    
                    <p className="text-sm text-muted-foreground mb-3">{item.description}</p>
                    
                    <div className="grid grid-cols-2 gap-4 text-sm bg-muted/50 p-3 rounded-lg">
                      <div>
                        <span className="font-semibold block mb-1">Path</span>
                        <code className="text-xs break-all text-muted-foreground">{item.path}</code>
                      </div>
                      <div>
                        <span className="font-semibold block mb-1">Expected Impact</span>
                        <p className="text-muted-foreground">{item.impact}</p>
                      </div>
                    </div>
                    
                    <div className="mt-4 flex justify-end space-x-3">
                      <button className="px-4 py-2 border rounded-md text-sm hover:bg-muted transition">
                        View Files
                      </button>
                      <button className="px-4 py-2 bg-destructive/10 text-destructive border border-destructive/20 rounded-md text-sm hover:bg-destructive hover:text-destructive-foreground transition">
                        Clean Up
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

export default App;
