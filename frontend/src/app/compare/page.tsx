"use client";

import React, { useState, useEffect } from "react";
import axios from "axios";
import { Loader2, Zap, AlertTriangle, Download } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine
} from "recharts";
import DominanceMap from "@/components/DominanceMap";
import { getApiErrorMessage } from "@/lib/apiError";

interface TelemetryPoint {
  distance: number;
  speed: number;
  throttle: number;
  brake: number;
  gear: number;
  rpm: number;
  drs: number;
  time: number;
  acceleration: number;
}

interface DriverComparison {
  code: string;
  color: string;
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
          const gps: string[] = Array.from(new Set<string>(res.data.map((r: any) => r.country)));
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
      setError(getApiErrorMessage(err, "Failed to load comparison data."));
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
        [data.driver1.code + "_DRS"]: t.drs,
        [data.driver1.code + "_Acceleration"]: t.acceleration,
        [data.driver1.code + "_Time"]: t.time
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
      existing[data.driver2.code + "_Acceleration"] = t.acceleration;
      existing[data.driver2.code + "_Time"] = t.time;
      mergedMap.set(dist, existing);
    });

    const mergedArray = Array.from(mergedMap.values()).sort((a, b) => a.distance - b.distance);

    let last_d1_speed = 0;
    let last_d2_speed = 0;
    let last_d1_time = 0;
    let last_d2_time = 0;

    mergedArray.forEach(pt => {
        if (pt[`${data.driver1.code}_Speed`] !== undefined) last_d1_speed = pt[`${data.driver1.code}_Speed`];
        if (pt[`${data.driver2.code}_Speed`] !== undefined) last_d2_speed = pt[`${data.driver2.code}_Speed`];
        if (pt[`${data.driver1.code}_Time`] !== undefined) last_d1_time = pt[`${data.driver1.code}_Time`];
        if (pt[`${data.driver2.code}_Time`] !== undefined) last_d2_time = pt[`${data.driver2.code}_Time`];

        pt.SpeedDiff = last_d1_speed - last_d2_speed;
        
        const time_diff_sec = last_d2_time - last_d1_time;
        pt.DistanceDiff = time_diff_sec * (last_d1_speed / 3.6);
    });

    return mergedArray;
  };

  const chartData = getMergedData();

  const formatLapTime = (seconds: number) => {
    if (!seconds) return "N/A";
    const m = Math.floor(seconds / 60);
    const s = (seconds % 60).toFixed(3);
    return `${m}:${s.padStart(6, '0')}`;
  };

  // Plain <a> tags don't go through axios, so they need the backend origin spelled
  // out explicitly (axios.defaults.baseURL only applies to axios-issued requests).
  const getResultCardUrl = (driverCode: string) => {
    const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    const params = new URLSearchParams({ year: String(year), gp, session, driver: driverCode });
    return `${apiBase}/api/v1/share/result-card?${params.toString()}`;
  };

  return (
    <div className="w-full py-4 md:p-8 max-w-7xl mx-auto space-y-8 flex flex-col">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 shrink-0">
        <div>
          <h1 className="font-display text-3xl font-extrabold leading-none tracking-tight text-chalk md:text-4xl">
            Head to head
          </h1>
          <p className="mt-2 max-w-prose text-sm text-mute">
            Fastest Lap Telemetry Overlay
          </p>
        </div>
      </div>

      {/* Control Panel */}
      <div className="rounded-panel border border-gantry bg-kerb p-6 shrink-0">
        <form onSubmit={handleCompare} className="grid grid-cols-1 md:grid-cols-6 gap-4">
          <div>
            <label className="block text-xs font-bold text-mute mb-2">YEAR</label>
            <input aria-label="Year" type="number" value={year} onChange={e => setYear(parseInt(e.target.value))} className="w-full bg-kerb border border-edge text-chalk rounded-panel px-4 py-2 " />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-bold text-mute mb-2">Grand Prix</label>
            <select aria-label="Grand Prix" value={gp} onChange={e => setGp(e.target.value)} className="w-full bg-kerb border border-edge text-chalk rounded-panel px-4 py-2 ">
              {availableGPs.map(g => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-mute mb-2">Session</label>
            <select aria-label="Session" value={session} onChange={e => setSession(e.target.value)} className="w-full bg-kerb border border-edge text-chalk rounded-panel px-4 py-2 ">
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
              <label className="block text-xs font-bold text-mute mb-2">Driver 1</label>
              <select aria-label="Driver 1" value={driver1} onChange={e => setDriver1(e.target.value)} className="w-full bg-kerb border border-edge text-chalk rounded-panel px-4 py-2 ">
                {availableDrivers.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-mute mb-2">Lap (optional)</label>
              <input aria-label="Lap (Optional)" type="number" placeholder="Fastest" value={driver1Lap} onChange={e => setDriver1Lap(e.target.value)} className="w-full bg-kerb border border-edge text-chalk rounded-panel px-4 py-2 " />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-bold text-mute mb-2">Driver 2</label>
              <select aria-label="Driver 2" value={driver2} onChange={e => setDriver2(e.target.value)} className="w-full bg-kerb border border-edge text-chalk rounded-panel px-4 py-2 ">
                {availableDrivers.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-mute mb-2">Lap (optional)</label>
              <input aria-label="Lap (Optional)" type="number" placeholder="Fastest" value={driver2Lap} onChange={e => setDriver2Lap(e.target.value)} className="w-full bg-kerb border border-edge text-chalk rounded-panel px-4 py-2 " />
            </div>
          </div>
          <div className="md:col-span-6 flex justify-end mt-2">
            <button type="submit" disabled={loading} className="bg-chalk text-tarmac hover:bg-white hover:bg-live/90 font-bold py-2 px-8 rounded-panel transition-colors flex items-center gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              COMPARE
            </button>
          </div>
        </form>
      </div>

      {error && (
        <div className="bg-live/10 border border-live/40 text-live-text p-4 rounded-panel flex items-center gap-3 shrink-0">
          <AlertTriangle className="w-5 h-5" />
          {error}
        </div>
      )}

      {/* Results */}
      {data && !loading && (
        <div className="flex flex-col gap-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 gap-6 shrink-0">
            <div className="rounded-panel border border-gantry bg-kerb p-6 border-live/40 flex justify-between items-center bg-gradient-to-r to-transparent">
              <div>
                <h2 className="text-3xl font-black text-chalk">{data.driver1.code}</h2>
                <p className="text-mute text-sm mt-1">Tyre: {data.driver1.compound}</p>
              </div>
              <div className="text-right flex items-center gap-4">
                <p className="text-3xl font-bold text-chalk">{formatLapTime(data.driver1.lap_time)}</p>
                <a
                  href={getResultCardUrl(data.driver1.code)}
                  download={`${data.driver1.code}-${year}-${gp}.png`}
                  title="Download shareable result card"
                  className="text-faint hover:text-chalk transition-colors"
                >
                  <Download className="w-5 h-5" />
                </a>
              </div>
            </div>

            <div className="rounded-panel border border-gantry bg-kerb p-6 border-edge flex justify-between items-center bg-gradient-to-r to-transparent">
              <div>
                <h2 className="text-3xl font-black text-chalk">{data.driver2.code}</h2>
                <p className="text-mute text-sm mt-1">Tyre: {data.driver2.compound}</p>
              </div>
              <div className="text-right flex items-center gap-4">
                <p className="text-3xl font-bold text-chalk">{formatLapTime(data.driver2.lap_time)}</p>
                <a
                  href={getResultCardUrl(data.driver2.code)}
                  download={`${data.driver2.code}-${year}-${gp}.png`}
                  title="Download shareable result card"
                  className="text-faint hover:text-chalk transition-colors"
                >
                  <Download className="w-5 h-5" />
                </a>
              </div>
            </div>
          </div>

          {/* Dominance Map */}
          <div className="rounded-panel border border-gantry bg-kerb p-6 flex flex-col gap-6 shrink-0 h-[600px]">
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
          <div className="rounded-panel border border-gantry bg-kerb p-6 flex flex-col gap-6">
            
            {/* Speed */}
            <div className="w-full h-[300px]">
              <h3 className="text-sm font-bold text-chalk mb-2">Speed (km/h)</h3>
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
                  <Line connectNulls={true} type="monotone" dataKey={`${data.driver1.code}_Speed`} stroke={data.driver1.color} strokeWidth={2} dot={false} name={`${data.driver1.code} Speed`} isAnimationActive={false} />
                  <Line connectNulls={true} type="monotone" dataKey={`${data.driver2.code}_Speed`} stroke={data.driver2.color} strokeWidth={2} dot={false} name={`${data.driver2.code} Speed`} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Throttle */}
            <div className="w-full h-[150px]">
              <h3 className="text-sm font-bold text-chalk mb-2">Throttle (%)</h3>
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
                  <Line connectNulls={true} type="monotone" dataKey={`${data.driver1.code}_Throttle`} stroke={data.driver1.color} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line connectNulls={true} type="monotone" dataKey={`${data.driver2.code}_Throttle`} stroke={data.driver2.color} strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Brake */}
            <div className="w-full h-[150px]">
              <h3 className="text-sm font-bold text-chalk mb-2">Brake</h3>
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
                  <Line connectNulls={true} type="monotone" dataKey={`${data.driver1.code}_Brake`} stroke={data.driver1.color} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line connectNulls={true} type="monotone" dataKey={`${data.driver2.code}_Brake`} stroke={data.driver2.color} strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Gear */}
            <div className="w-full h-[150px]">
              <h3 className="text-sm font-bold text-chalk mb-2">Gear</h3>
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
                  <Line connectNulls={true} type="stepAfter" dataKey={`${data.driver1.code}_Gear`} stroke={data.driver1.color} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line connectNulls={true} type="stepAfter" dataKey={`${data.driver2.code}_Gear`} stroke={data.driver2.color} strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* RPM */}
            <div className="w-full h-[150px]">
              <h3 className="text-sm font-bold text-chalk mb-2">RPM</h3>
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
                  <Line connectNulls={true} type="monotone" dataKey={`${data.driver1.code}_RPM`} stroke={data.driver1.color} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line connectNulls={true} type="monotone" dataKey={`${data.driver2.code}_RPM`} stroke={data.driver2.color} strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* DRS */}
            <div className="w-full h-[100px]">
              <h3 className="text-sm font-bold text-chalk mb-2">DRS</h3>
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
                  <Line connectNulls={true} type="stepAfter" dataKey={`${data.driver1.code}_DRS`} stroke={data.driver1.color} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line connectNulls={true} type="stepAfter" dataKey={`${data.driver2.code}_DRS`} stroke={data.driver2.color} strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Acceleration */}
            <div className="w-full h-[150px]">
              <h3 className="text-sm font-bold text-chalk mb-2">Acceleration (m/s²)</h3>
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
                  <Line connectNulls={true} type="monotone" dataKey={`${data.driver1.code}_Acceleration`} stroke={data.driver1.color} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line connectNulls={true} type="monotone" dataKey={`${data.driver2.code}_Acceleration`} stroke={data.driver2.color} strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Speed Difference */}
            <div className="w-full h-[150px]">
              <h3 className="text-sm font-bold text-chalk mb-2">Speed Diff (km/h)</h3>
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
                  <ReferenceLine y={0} stroke="#ffffff40" strokeDasharray="3 3" />
                  <Line connectNulls={true} type="monotone" dataKey="SpeedDiff" stroke="#ffffff" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Distance Difference */}
            <div className="w-full h-[150px]">
              <h3 className="text-sm font-bold text-chalk mb-2">Distance Diff (m)</h3>
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
                  <ReferenceLine y={0} stroke="#ffffff40" strokeDasharray="3 3" />
                  <Line connectNulls={true} type="monotone" dataKey="DistanceDiff" stroke="#ffffff" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
