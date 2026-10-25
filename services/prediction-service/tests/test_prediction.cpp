#include <iostream>
#include <cassert>
#include <cmath>
#include "haversine.hpp"
#include "prediction_engine.hpp"

using namespace logistics;

void test_haversine() {
    std::cout << "Running test_haversine..." << std::endl;

    // Zero distance test
    double dist_zero = calculate_haversine_distance(47.6062, -122.3321, 47.6062, -122.3321);
    assert(dist_zero < 0.001);
    (void)dist_zero;

    // Seattle, WA to Portland, OR (~233.5 km)
    double dist_sea_pdx = calculate_haversine_distance(47.6062, -122.3321, 45.5152, -122.6784);
    assert(dist_sea_pdx > 230.0 && dist_sea_pdx < 236.0);

    // New York, NY to Los Angeles, CA (~3935 km)
    double dist_nyc_la = calculate_haversine_distance(40.7128, -74.0060, 34.0522, -118.2437);
    assert(dist_nyc_la > 3900.0 && dist_nyc_la < 4000.0);
    (void)dist_nyc_la;

    std::cout << "  -> test_haversine PASSED (Seattle-Portland: " << dist_sea_pdx << " km)" << std::endl;
}

void test_prediction_engine() {
    std::cout << "Running test_prediction_engine..." << std::endl;

    PredictionRequest req;
    req.shipmentId = "test-shipment-001";
    req.currentLat = 47.6062;
    req.currentLon = -122.3321;
    req.destLat = 45.5152;
    req.destLon = -122.6784;
    req.currentSpeedKmh = 60.0;
    req.averageSpeedKmh = 60.0;

    auto res = PredictionEngine::predict(req);

    assert(res.shipmentId == "test-shipment-001");
    assert(res.remainingDistanceKm > 230.0 && res.remainingDistanceKm < 236.0);
    assert(res.effectiveSpeedKmh == 60.0);
    // 233.5 / 60 ~ 3.89 hours
    assert(res.estimatedTravelHours > 3.7 && res.estimatedTravelHours < 4.1);
    assert(!res.estimatedDelivery.empty());
    assert(!res.explanatoryFactors.empty());

    std::cout << "  -> test_prediction_engine PASSED (ETA: " << res.estimatedDelivery
              << ", Hours: " << res.estimatedTravelHours << ")" << std::endl;
}

void test_risk_scoring() {
    std::cout << "Running test_risk_scoring..." << std::endl;

    // Test with far future delivery: should be LOW risk
    PredictionRequest req_low;
    req_low.shipmentId = "risk-low";
    req_low.currentLat = 47.6062;
    req_low.currentLon = -122.3321;
    req_low.destLat = 45.5152;
    req_low.destLon = -122.6784;
    req_low.currentSpeedKmh = 65.0;
    req_low.averageSpeedKmh = 65.0;
    req_low.scheduledDelivery = "2030-01-01T12:00:00Z";

    auto res_low = PredictionEngine::predict(req_low);
    assert(res_low.riskLevel == "LOW");
    assert(res_low.delayRiskScore < 0.25);

    // Test with past delivery date: should be CRITICAL risk
    PredictionRequest req_crit;
    req_crit.shipmentId = "risk-crit";
    req_crit.currentLat = 47.6062;
    req_crit.currentLon = -122.3321;
    req_crit.destLat = 45.5152;
    req_crit.destLon = -122.6784;
    req_crit.currentSpeedKmh = 65.0;
    req_crit.averageSpeedKmh = 65.0;
    req_crit.scheduledDelivery = "2020-01-01T12:00:00Z";

    auto res_crit = PredictionEngine::predict(req_crit);
    assert(res_crit.riskLevel == "CRITICAL");
    assert(res_crit.delayRiskScore > 0.85);

    std::cout << "  -> test_risk_scoring PASSED" << std::endl;
}

int main() {
    std::cout << "=== Running MS4 C++ Prediction Unit Tests ===" << std::endl;
    test_haversine();
    test_prediction_engine();
    test_risk_scoring();
    std::cout << "=== All C++ Unit Tests PASSED Successfully ===" << std::endl;
    return 0;
}
