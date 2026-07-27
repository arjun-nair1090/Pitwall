import pytest
from unittest.mock import AsyncMock, patch
from app.services.f1_data_service import F1DataService

@pytest.mark.asyncio
async def test_get_live_telemetry_success():
    service = F1DataService()
    
    # Mocking drivers and session to ensure we are testing the logic, not network
    mock_drivers = [
        {"driver_number": 44, "code": "HAM", "first_name": "Lewis", "last_name": "Hamilton", "team_name": "Mercedes", "team_color": "#27F4D2", "country_code": "GBR"}
    ]
    mock_car_data = [
        {
            "date": "2024-01-01T00:00:00Z",
            "speed": 300.0,
            "throttle": 100.0,
            "brake": 0.0,
            "n_gear": 7,
            "rpm": 12000,
            "drs": 1
        }
    ]

    with patch.object(F1DataService, 'get_latest_session_key', return_value=12345), \
         patch.object(F1DataService, 'get_drivers', return_value=mock_drivers), \
         patch.object(F1DataService, 'fetch_openf1_async', return_value=mock_car_data):
        
        telemetry = await service.get_live_telemetry("HAM")
        
        assert telemetry["driver"] == "HAM"
        assert telemetry["speed"] == 300.0
        assert telemetry["throttle"] == 100.0
        assert telemetry["brake"] == 0.0
        assert telemetry["gear"] == 7
        assert telemetry["rpm"] == 12000
        assert telemetry["drs"] is True or telemetry["drs"] is False

@pytest.mark.asyncio
async def test_get_live_telemetry_driver_not_found():
    service = F1DataService()
    mock_drivers = [
        {"driver_number": 44, "code": "HAM", "first_name": "Lewis", "last_name": "Hamilton", "team_name": "Mercedes", "team_color": "#27F4D2", "country_code": "GBR"}
    ]

    with patch.object(F1DataService, 'get_latest_session_key', return_value=12345), \
         patch.object(F1DataService, 'get_drivers', return_value=mock_drivers):
        
        with pytest.raises(ValueError, match="Driver code VER not found for the current session"):
            await service.get_live_telemetry("VER")
