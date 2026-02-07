#!/bin/bash

# Test Script for Location Name Changes
# This script automates running the key tests for location name functionality

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test results
PASSED=0
FAILED=0

echo "=================================="
echo "Location Name Changes - Test Suite"
echo "=================================="
echo ""

# Function to run a test and track results
run_test() {
    local test_name=$1
    local test_command=$2
    
    echo -e "${YELLOW}Running: $test_name${NC}"
    
    if eval "$test_command"; then
        echo -e "${GREEN}✓ PASSED: $test_name${NC}"
        ((PASSED++))
    else
        echo -e "${RED}✗ FAILED: $test_name${NC}"
        ((FAILED++))
    fi
    echo ""
}

# 1. Lint Check
echo "Step 1: Code Quality Checks"
echo "----------------------------"
run_test "Linting" "pnpm lint"

# 2. Type Check
run_test "TypeScript Type Checking" "pnpm typecheck"

# 3. Format Check
run_test "Code Formatting" "pnpm format"

# 4. Validator Tests
echo "Step 2: Validator Tests"
echo "-----------------------"
run_test "Location Validator Tests" "cd packages/validators && pnpm test"

# 5. API Tests
echo "Step 3: API Tests"
echo "-----------------"
run_test "Location API Tests" "cd packages/api && pnpm test location.test.ts"

# 6. Map App Tests (if they exist)
echo "Step 4: Map App Tests"
echo "---------------------"
if [ -d "apps/map/__tests__" ]; then
    run_test "Map App Tests" "cd apps/map && pnpm test"
else
    echo -e "${YELLOW}⚠ No automated map app tests found${NC}"
fi

# Summary
echo ""
echo "=================================="
echo "Test Results Summary"
echo "=================================="
echo -e "Tests Passed: ${GREEN}$PASSED${NC}"
echo -e "Tests Failed: ${RED}$FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ All automated tests passed!${NC}"
    echo ""
    echo "Next Steps:"
    echo "1. Review TESTING_PLAN.md for manual testing procedures"
    echo "2. Test the admin portal location creation UI"
    echo "3. Test the map location form UI"
    echo "4. Verify browser compatibility"
    echo ""
    exit 0
else
    echo -e "${RED}✗ Some tests failed. Please review the errors above.${NC}"
    echo ""
    exit 1
fi
