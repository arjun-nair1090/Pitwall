from typing import Dict, Any, List
from app.services.f1_data_service import f1_service

class AIStrategist:
    def __init__(self):
        # Base tyre performance characteristics (seconds of degradation per lap)
        self.degradation_rates = {
            "SOFT": 0.25,
            "MEDIUM": 0.14,
            "HARD": 0.07,
            "WET": 0.40,
            "INTERMEDIATE": 0.30
        }
        # Optimal tyre life spans (in laps)
        self.optimal_lifespans = {
            "SOFT": (10, 18),
            "MEDIUM": (18, 30),
            "HARD": (28, 45),
            "WET": (15, 30),
            "INTERMEDIATE": (15, 28)
        }

    async def get_strategy_recommendations(self, session_key: int) -> Dict[str, Any]:
        """Generate live strategy recommendations, pit windows, and undercut threats."""
        timing = await f1_service.get_live_timing(session_key)
        drivers = await f1_service.get_drivers(session_key)
        weather = await f1_service.get_live_weather(session_key)
        race_control = await f1_service.get_live_race_control(session_key)
        
        drivers_map = {d["driver_number"]: d for d in drivers}
        
        # Analyze tyre wear and degradation for each driver
        tyre_status = {}
        undercut_threats = []
        pit_windows = {}
        
        # Find undercut/overcut threats
        # Group drivers by position
        pos_drivers = []
        for num_str, t in timing.items():
            pos = t.get("position")
            if pos is not None:
                pos_drivers.append((pos, int(num_str), t))
        
        pos_drivers.sort(key=lambda x: x[0])
        
        # Check consecutive pairs for undercut threats
        for i in range(len(pos_drivers) - 1):
            leader_pos, leader_num, leader_t = pos_drivers[i]
            chaser_pos, chaser_num, chaser_t = pos_drivers[i+1]
            
            gap = chaser_t.get("gap_to_next") or chaser_t.get("gap_to_leader", 99.0)
            # If gap is under 1.5 seconds and they are in the pit window
            if gap <= 1.5:
                leader_code = drivers_map.get(leader_num, {}).get("code", f"#{leader_num}")
                chaser_code = drivers_map.get(chaser_num, {}).get("code", f"#{chaser_num}")
                
                undercut_threats.append({
                    "leader": leader_code,
                    "chaser": chaser_code,
                    "gap": gap,
                    "severity": "HIGH" if gap <= 0.8 else "MODERATE",
                    "reason": f"{chaser_code} is within undercut range of {leader_code} ({gap}s). Pit stop window open."
                })
        
        # Predict pit windows and tyre age details
        for num_str, t in timing.items():
            num = int(num_str)
            d = drivers_map.get(num)
            if not d:
                continue
                
            compound = (t.get("compound") or "MEDIUM").upper()
            if compound not in self.degradation_rates:
                compound = "MEDIUM"
                
            age = t.get("tyre_age") or 5 # Fallback to 5 if unknown
            deg_rate = self.degradation_rates[compound]
            current_deg = age * deg_rate
            
            # Pit window estimate
            limits = self.optimal_lifespans[compound]
            current_lap = t.get("lap_number") or 1
            
            window_start = max(1, limits[0] - age)
            window_end = max(1, limits[1] - age)
            
            pit_windows[d["code"]] = {
                "driver_code": d["code"],
                "team_name": d["team_name"],
                "compound": compound,
                "tyre_age": age,
                "estimated_deg_loss_seconds": round(current_deg, 2),
                "laps_remaining_in_window": f"{window_start} to {window_end} laps",
                "status": "CRITICAL" if age > limits[1] else "OPEN" if age >= limits[0] else "CLOSED"
            }
            
        # Check for safety car / cheap pit stop
        sc_active = False
        sc_reason = ""
        for msg in race_control:
            if msg.get("flag") in ["SAFETY CAR", "VIRTUAL SAFETY CAR"]:
                sc_active = True
                sc_reason = msg.get("message", "Safety Car active")
                break
                
        strategy_summary = {
            "undercut_threats": undercut_threats,
            "pit_windows": pit_windows,
            "safety_car_opportunity": {
                "active": sc_active,
                "reason": sc_reason,
                "recommendation": "PIT NOW (Cheap Pit Stop)" if sc_active else "Standard strategy in place"
            },
            "weather_warning": {
                "rain_risk": "HIGH" if weather and weather.get("rainfall") == 1 else "LOW",
                "recommendation": "Prepare Inters/Wets" if weather and weather.get("rainfall") == 1 else "Dry tyres optimal"
            }
        }
        return strategy_summary

ai_strategist = AIStrategist()
