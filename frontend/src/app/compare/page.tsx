"use client";

import React, { useState, useEffect } from "react";
import axios from "axios";
import { Loader2, Zap, AlertTriangle } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from "recharts";
import DominanceMap from "@/components/DominanceMap";

interface TelemetryPoint {
  distance: number;
  speed: number;
  throttle: number;
  brake: number;
  gear: number;
  rpm: number;
  drs: number;
  time: number;
}

interface DriverComparison {
  code: string;
  lap_time: number;
  compound: string;
  telemetry: TelemetryPoint[];
}

interface CompareResponse {
  driver1: DriverComparison;
  driver2: DriverComparison;
}

export default function ComparePage() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState<number>(currentYear);
  const [gp, setGp] = useState<string>("");
  const [session, setSession] = useState<string>("R");
  const [driver1, setDriver1] = useState<string>("");
  const [driver2, setDriver2] = useState<string>("");
  const [driver1Lap, setDriver1Lap] = useState<string>("");
  const [driver2Lap, setDriver2Lap] = useState<string>("");
  
  const [availableGPs, setAvailableGPs] = useState<string[]>([]);
  const [availableDrivers, setAvailableDrivers] = useState<string[]>([]);
  
  const [data, setData] = useState<CompareResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Fetch GPs and Drivers when year changes
  useEffect(() => {
    let isSubscribed = true;
    
    // Fetch GPs
    axios.get(`/api/v1/races/historical?year=${year}`)
      .then(res => {
        if (isSubscribed && res.data && res.data.length > 0) {
          const gps = res.data.map((r: any) => r.country);
          setAvailableGPs(gps);
          if (!gps.includes(gp)) setGp(gps[0]);
        }
      })
      .catch(err => console.error(err));
      
    // Fetch Drivers
    axios.get(`/api/v1/stats/standings?year=${year}`)
      .then(res => {
        if (isSubscribed && res.data && res.data.driver_standings) {
          const drvs = res.data.driver_standings.map((d: any) => d.driver_code);
          setAvailableDrivers(drvs);
          if (drvs.length >= 2) {
            setDriver1(drvs[0]);
            setDriver2(drvs[1]);
          }
        }
      })
      .catch(err => console.error(err));
      
    return () => { isSubscribed = false; };
  }, [year]);

  if (!isMounted) return null;

  const handleCompare = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await axios.post<CompareResponse>(`/api/v1/telemetry/compare`, {
        year,
        gp,
        session,
        driver1: driver1.toUpperCase(),
        driver2: driver2.toUpperCase(),
        ...(driver1Lap && { driver1_lap: parseInt(driver1Lap) }),
        ...(driver2Lap && { driver2_lap: parseInt(driver2Lap) })
      });
      setData(res.data);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to load comparison data.");
    } finally {
      setLoading(false);
    }
  };

  const getMergedData = () => {
    if (!data) return [];
    
    const mergedMap = new Map<number, any>();
    
    data.driver1.telemetry?.forEach(t => {
      mergedMap.set(Math.round(t.distance), { 
        distance: Math.round(t.distance), 
        [data.driver1.code + "_Speed"]: t.speed, 
        [data.driver1.code + "_Throttle"]: t.throttle, 
        [data.driver1.code + "_Brake"]: t.brake,
        [data.driver1.code + "_Gear"]: t.gear,
        [data.driver1.code + "_RPM"]: t.rpm,
        [data.driver1.code + "_DRS"]: t.drs
      });
    });
    
    data.driver2.telemetry?.forEach(t => {
      const dist = Math.round(t.distance);
      const existing = mergedMap.get(dist) || { distance: dist };
      existing[data.driver2.code + "_Speed"] = t.speed;
      existing[data.driver2.code + "_Throttle"] = t.throttle;
      existing[data.driver2.code + "_Brake"] = t.brake;
      existing[data.driver2.code + "_Gear"] = t.gear;
      existing[data.driver2.code + "_RPM"] = t.rpm;
      existing[data.driver2.code + "_DRS"] = t.drs;
      mergedMap.set(dist, existing);
    });

    const mergedArray = Array.from(mergedMap.values()).sort((a, b) => a.distance - b.distance);
    return mergedArray;
  };

  const chartData = getMergedData();

  const formatLapTime = (seconds: number) => {
    if (!seconds) return "N/A";
    const m = Math.floor(seconds / 60);
    const s = (seconds % 60).toFixed(3);
    return `${m}:${s.padStart(6, '0')}`;
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 animate-fade-in flex flex-col">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/10 pb-6 shrink-0">
        <div>
          <h1 className="text-4xl font-black italic tracking-tighter text-white uppercase flex items-center gap-3">
            <Zap className="w-8 h-8 text-f1-red" />
            Head-to-Head
          </h1>
          <p className="text-white/50 text-sm font-titillium tracking-wide mt-1">
            Fastest Lap Telemetry Overlay
          </p>
        </div>
      </div>

      {/* Control Panel */}
      <div className="glass-panel p-6 rounded-xl border border-white/5 shrink-0">
        <form onSubmit={handleCompare} className="grid grid-cols-1 md:grid-cols-6 gap-4">
          <div>
            <label className="block text-xs font-titillium font-bold text-white/60 mb-2">YEAR</label>
            <input type="number" value={year} onChange={e => setYear(parseInt(e.target.value))} className="w-full bg-black/50 border border-white/10 text-white rounded-md px-4 py-2 font-titillium focus:outline-none focus:border-f1-red" />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-titillium font-bold text-white/60 mb-2">GRAND PRIX</label>
            <select value={gp} onChange={e => setGp(e.target.value)} className="w-full bg-black/50 border border-white/10 text-white rounded-md px-4 py-2 font-titillium focus:outline-none focus:border-f1-red">
              {availableGPs.map(g => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-titillium font-bold text-white/60 mb-2">SESSION</label>
            <select value={session} onChange={e => setSession(e.target.value)} className="w-full bg-black/50 border border-white/10 text-white rounded-md px-4 py-2 font-titillium focus:outline-none focus:border-f1-red">
              <option value="FP1">FP1</option>
              <option value="FP2">FP2</option>
              <option value="FP3">FP3</option>
              <option value="Q">Qualifying</option>
              <option value="SQ">Sprint Quali</option>
              <option value="Sprint">Sprint</option>
              <option value="R">Race</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-titillium font-bold text-white/60 mb-2">DRIVER 1</label>
              <select value={driver1} onChange={e => setDriver1(e.target.value)} className="w-full bg-black/50 border border-white/10 text-white rounded-md px-4 py-2 font-titillium focus:outline-none focus:border-f1-red">
                {availableDrivers.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-titillium font-bold text-white/60 mb-2">LAP (OPTIONAL)</label>
              <input type="number" placeholder="Fastest" value={driver1Lap} onChange={e => setDriver1Lap(e.target.value)} className="w-full bg-black/50 border border-white/10 text-white rounded-md px-4 py-2 font-titillium focus:outline-none focus:border-f1-red" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-titillium font-bold text-white/60 mb-2">DRIVER 2</label>
              <select value={driver2} onChange={e => setDriver2(e.target.value)} className="w-full bg-black/50 border border-white/10 text-white rounded-md px-4 py-2 font-titillium focus:outline-none focus:border-f1-red">
                {availableDrivers.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-titillium font-bold text-white/60 mb-2">LAP (OPTIONAL)</label>
              <input type="number" placeholder="Fastest" value={driver2Lap} onChange={e => setDriver2Lap(e.target.value)} className="w-full bg-black/50 border border-white/10 text-white rounded-md px-4 py-2 font-titillium focus:outline-none focus:border-f1-red" />
            </div>
          </div>
          <div className="md:col-span-6 flex justify-end mt-2">
            <button type="submit" disabled={loading} className="bg-f1-red hover:bg-red-700 text-white font-titillium font-bold py-2 px-8 rounded-md transition-colors flex items-center gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              COMPARE
            </button>
          </div>
        </form>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-4 rounded-lg font-titillium flex items-center gap-3 shrink-0">
          <AlertTriangle className="w-5 h-5" />
          {error}
        </div>
      )}

      {/* Results */}
      {data && !loading && (
        <div className="flex flex-col gap-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 gap-6 shrink-0">
            <div className="glass-panel p-6 rounded-xl border border-f1-red/30 flex justify-between items-center bg-gradient-to-r from-f1-red/10 to-transparent">
              <div>
                <h2 className="text-3xl font-black text-white">{data.driver1.code}</h2>
                <p className="text-white/60 font-titillium text-sm uppercase mt-1">Tyre: {data.driver1.compound}</p>
              </div>
              <div className="text-right">
                <p className="text-3xl font-titillium font-bold text-f1-red">{formatLapTime(data.driver1.lap_time)}</p>
              </div>
            </div>
            
            <div className="glass-panel p-6 rounded-xl border border-f1-blue/30 flex justify-between items-center bg-gradient-to-r from-f1-blue/10 to-transparent">
              <div>
                <h2 className="text-3xl font-black text-white">{data.driver2.code}</h2>
                <p className="text-white/60 font-titillium text-sm uppercase mt-1">Tyre: {data.driver2.compound}</p>
              </div>
              <div className="text-right">
                <p className="text-3xl font-titillium font-bold text-f1-blue">{formatLapTime(data.driver2.lap_time)}</p>
              </div>
            </div>
          </div>

          {/* Dominance Map */}
          <div className="glass-panel p-6 rounded-xl border border-white/5 flex flex-col gap-6 shrink-0 h-[600px]">
            <DominanceMap 
              year={year} 
              gp={gp} 
              session={session} 
              driver1={data.driver1.code} 
              driver2={data.driver2.code} 
              telemetry1={data.driver1.telemetry as any}
              telemetry2={data.driver2.telemetry as any}
            />
          </div>

          {/* Telemetry Charts Container */}
          <div className="glass-panel p-6 rounded-xl border border-white/5 flex flex-col gap-6">
            
            {/* Speed */}
            <div className="w-full h-[300px]">
              <h3 className="text-sm font-bold font-titillium text-white mb-2 uppercase tracking-wider">Speed (km/h)</h3>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} syncId="telemetrySync" margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                  <XAxis dataKey="distance" hide={true} />
                  <YAxis stroke="#ffffff40" tick={{ fill: '#ffffff60', fontSize: 12 }} domain={['auto', 'auto']} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#111118', border: '1px solid #ffffff20', borderRadius: '8px' }}
                    itemStyle={{ fontFamily: 'Titillium Web', fontWeight: 'bold' }}
                    labelStyle={{ display: 'none' }}
                  />
                  <Legend wrapperStyle={{ fontFamily: 'Titillium Web', paddingTop: '10px' }} />
                  <Line type="basis" dataKey={`${data.driver1.code}_Speed`} stroke="#e10600" strokeWidth={2} dot={false} name={`${data.driver1.code} Speed`} isAnimationActive={false} />
                  <Line type="basis" dataKey={`${data.driver2.code}_Speed`} stroke="#00d2be" strokeWidth={2} dot={false} name={`${data.driver2.code} Speed`} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Throttle */}
            <div className="w-full h-[150px]">
              <h3 className="text-sm font-bold font-titillium text-white mb-2 uppercase tracking-wider">Throttle (%)</h3>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} syncId="telemetrySync" margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                  <XAxis dataKey="distance" hide={true} />
                  <YAxis stroke="#ffffff40" tick={{ fill: '#ffffff60', fontSize: 12 }} domain={[0, 100]} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#111118', border: '1px solid #ffffff20', borderRadius: '8px' }}
                    itemStyle={{ fontFamily: 'Titillium Web', fontWeight: 'bold' }}
                    labelStyle={{ display: 'none' }}
                  />
                  <Line type="basis" dataKey={`${data.driver1.code}_Throttle`} stroke="#e10600" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="basis" dataKey={`${data.driver2.code}_Throttle`} stroke="#00d2be" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Brake */}
            <div className="w-full h-[150px]">
              <h3 className="text-sm font-bold font-titillium text-white mb-2 uppercase tracking-wider">Brake</h3>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} syncId="telemetrySync" margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                  <XAxis dataKey="distance" hide={true} />
                  <YAxis stroke="#ffffff40" tick={{ fill: '#ffffff60', fontSize: 12 }} domain={[0, 100]} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#111118', border: '1px solid #ffffff20', borderRadius: '8px' }}
                    itemStyle={{ fontFamily: 'Titillium Web', fontWeight: 'bold' }}
                    labelStyle={{ display: 'none' }}
                  />
                  <Line type="basis" dataKey={`${data.driver1.code}_Brake`} stroke="#e10600" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="basis" dataKey={`${data.driver2.code}_Brake`} stroke="#00d2be" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Gear */}
            <div className="w-full h-[150px]">
              <h3 className="text-sm font-bold font-titillium text-white mb-2 uppercase tracking-wider">Gear</h3>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} syncId="telemetrySync" margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                  <XAxis dataKey="distance" hide={true} />
                  <YAxis stroke="#ffffff40" tick={{ fill: '#ffffff60', fontSize: 12 }} domain={[1, 8]} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#111118', border: '1px solid #ffffff20', borderRadius: '8px' }}
                    itemStyle={{ fontFamily: 'Titillium Web', fontWeight: 'bold' }}
                    labelStyle={{ display: 'none' }}
                  />
                  <Line type="stepAfter" dataKey={`${data.driver1.code}_Gear`} stroke="#e10600" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="stepAfter" dataKey={`${data.driver2.code}_Gear`} stroke="#00d2be" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* RPM */}
            <div className="w-full h-[150px]">
              <h3 className="text-sm font-bold font-titillium text-white mb-2 uppercase tracking-wider">RPM</h3>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} syncId="telemetrySync" margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                  <XAxis dataKey="distance" hide={true} />
                  <YAxis stroke="#ffffff40" tick={{ fill: '#ffffff60', fontSize: 12 }} domain={['auto', 'auto']} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#111118', border: '1px solid #ffffff20', borderRadius: '8px' }}
                    itemStyle={{ fontFamily: 'Titillium Web', fontWeight: 'bold' }}
                    labelStyle={{ display: 'none' }}
                  />
                  <Line type="basis" dataKey={`${data.driver1.code}_RPM`} stroke="#e10600" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="basis" dataKey={`${data.driver2.code}_RPM`} stroke="#00d2be" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* DRS */}
            <div className="w-full h-[100px]">
              <h3 className="text-sm font-bold font-titillium text-white mb-2 uppercase tracking-wider">DRS</h3>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} syncId="telemetrySync" margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                  <XAxis dataKey="distance" stroke="#ffffff40" tick={{ fill: '#ffffff60', fontSize: 12 }} />
                  <YAxis stroke="#ffffff40" tick={{ fill: '#ffffff60', fontSize: 12 }} domain={[0, 14]} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#111118', border: '1px solid #ffffff20', borderRadius: '8px' }}
                    itemStyle={{ fontFamily: 'Titillium Web', fontWeight: 'bold' }}
                    labelStyle={{ display: 'none' }}
                  />
                  <Line type="stepAfter" dataKey={`${data.driver1.code}_DRS`} stroke="#e10600" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="stepAfter" dataKey={`${data.driver2.code}_DRS`} stroke="#00d2be" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
