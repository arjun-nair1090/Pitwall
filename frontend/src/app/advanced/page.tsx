"use client";

import React, { useState } from 'react';
import axios from 'axios';
import ErrorState from '@/components/ErrorState';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import PageHeader from '@/components/ui/PageHeader';
import Panel from '@/components/ui/Panel';
import Select from '@/components/ui/Select';
import PedalBehaviorChart, { DriverBehavior } from '@/components/PedalBehaviorChart';

export default function AdvancedAnalyticsPage() {
  const [year, setYear] = useState<number>(2024);
  const [gp, setGp] = useState<string>("Belgium");
  const [session, setSession] = useState<string>("Race");
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [pedalData, setPedalData] = useState<DriverBehavior[] | null>(null);

  // Hardcode available GPs for simplicity or fetch them
  const availableGPs = [
    "Bahrain", "Saudi Arabia", "Australia", "Japan", "China", 
    "Miami", "Emilia Romagna", "Monaco", "Canada", "Spain", 
    "Austria", "Great Britain", "Hungary", "Belgium", "Netherlands", 
    "Italy", "Azerbaijan", "Singapore", "United States", "Mexico", 
    "Brazil", "Las Vegas", "Qatar", "Abu Dhabi"
  ];

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setPedalData(null);

    try {
      const res = await axios.post("/api/v1/telemetry/pedal-behavior", {
        year,
        gp,
        session
      });
      setPedalData(res.data.data);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to load pedal behavior data.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Advanced analytics"
        description="Throttle, brake and coasting behaviour for every driver across a session."
      />

      <form onSubmit={handleAnalyze} className="grid grid-cols-1 gap-4 rounded-panel border border-gantry bg-kerb p-4 md:grid-cols-4">
        <Input label="Year" type="number" value={year} onChange={(e) => setYear(parseInt(e.target.value))} />
        <Select label="Grand Prix" value={gp} onChange={(e) => setGp(e.target.value)}>
          {availableGPs.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </Select>
        <Select label="Session" value={session} onChange={(e) => setSession(e.target.value)}>
          <option value="FP1">FP1</option>
          <option value="FP2">FP2</option>
          <option value="FP3">FP3</option>
          <option value="Q">Qualifying</option>
          <option value="SQ">Sprint qualifying</option>
          <option value="Sprint">Sprint</option>
          <option value="R">Race</option>
        </Select>
        <div className="flex items-end">
          <Button type="submit" variant="primary" loading={loading} className="w-full">
            Analyse
          </Button>
        </div>
      </form>

      {error && (
        <div className="mt-4">
          <ErrorState title="Couldn't run the analysis" message={error} />
        </div>
      )}

      {pedalData && !loading && (
        <Panel title="Pedal behaviour" meta={`${gp} ${year}, ${session}`} className="mt-4">
          <div className="p-4">
            <PedalBehaviorChart data={pedalData} />
          </div>
        </Panel>
      )}
    </>
  );
}
