#!/bin/bash

# Configuration
PORT=5001
SERVER_URL="http://localhost:$PORT"
COOKIE_JAR="/tmp/quantumclk_test_cookies.txt"

echo "=========================================================="
echo "QuantumCLK Biometric System — API Test Suite v2.0"
echo "=========================================================="

# 0. Health Check (public)
echo -e "\n[0/7] Testing Health Check..."
HEALTH=$(curl -s "$SERVER_URL/api/health")
echo "Response: $HEALTH"

# 1. Test Admin Login
echo -e "\n[1/7] Testing Admin Authentication Login..."
LOGIN_RESP=$(curl -s -c "$COOKIE_JAR" -X POST "$SERVER_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin", "password":"123456"}')
echo "Response: $LOGIN_RESP"

# 2. Test Fetch Employees (should be empty)
echo -e "\n[2/7] Testing Fetch Employees API (authenticated)..."
EMPLOYEES=$(curl -s -b "$COOKIE_JAR" "$SERVER_URL/api/employees")
echo "Response: $EMPLOYEES"

# 3. Test Unauthorized Access (no session)
echo -e "\n[3/7] Testing Unauthorized Access..."
UNAUTH=$(curl -s "$SERVER_URL/api/employees")
echo "Response: $UNAUTH"

# 4. Test ESP32 Attendance Log API
echo -e "\n[4/7] Testing Hardware Check-In Log (ESP32 simulation)..."
LOG_RESP=$(curl -s -X POST "$SERVER_URL/api/hardware/log" \
  -H "Content-Type: application/json" \
  -d '{"device":"GATE_1", "employee_id":"EMP-GEN-1001", "employee_name":"Test User", "action":"IN"}')
echo "Response: $LOG_RESP"

# 5. Test Fetch Attendance Logs
echo -e "\n[5/7] Testing Fetch Attendance History..."
LOGS=$(curl -s -b "$COOKIE_JAR" "$SERVER_URL/api/attendance")
echo "Response (Truncated): ${LOGS:0:300}..."

# 6. Test Session Status
echo -e "\n[6/7] Testing Session Status..."
SESSION=$(curl -s -b "$COOKIE_JAR" "$SERVER_URL/api/auth/session")
echo "Response: $SESSION"

# 7. Test Logout
echo -e "\n[7/7] Testing Logout..."
LOGOUT=$(curl -s -b "$COOKIE_JAR" -X POST "$SERVER_URL/api/auth/logout")
echo "Response: $LOGOUT"

# Cleanup
rm -f "$COOKIE_JAR"

echo -e "\n=========================================================="
echo "API testing complete."
echo "=========================================================="
