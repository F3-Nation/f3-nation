#!/bin/bash

# Quick Test Script for Phone Field Changes
# Run this script to validate all phone field functionality

set -e  # Exit on error

echo "=================================="
echo "Phone Field Testing Suite"
echo "=================================="
echo ""

# Change to repository root
cd "$(dirname "$0")"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check for pnpm
if ! command -v pnpm &> /dev/null; then
    echo -e "${RED}Error: pnpm is not installed${NC}"
    echo "Please install pnpm first:"
    echo "  npm install -g pnpm@8.15.1"
    echo ""
    exit 1
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Warning: node_modules not found${NC}"
    echo "Running pnpm install first..."
    pnpm install
    echo ""
fi

# Test counter
TESTS_PASSED=0
TESTS_FAILED=0

# Function to run test
run_test() {
    local test_name=$1
    local test_cmd=$2
    
    echo -e "${YELLOW}Testing: ${test_name}${NC}"
    
    if eval "$test_cmd"; then
        echo -e "${GREEN}✓ PASSED${NC}\n"
        ((TESTS_PASSED++))
        return 0
    else
        echo -e "${RED}✗ FAILED${NC}\n"
        ((TESTS_FAILED++))
        return 1
    fi
}

echo "Step 1: Code Quality Checks"
echo "----------------------------"

run_test "Lint Database Package" "pnpm -C packages/db lint"
run_test "Lint API Package" "pnpm -C packages/api lint"
run_test "Lint Map App" "pnpm -C apps/map lint"

echo "Step 2: Type Checking"
echo "---------------------"

run_test "TypeCheck Database Package" "pnpm -C packages/db typecheck"
run_test "TypeCheck API Package" "pnpm -C packages/api typecheck"
run_test "TypeCheck Map App" "pnpm -C apps/map typecheck"

echo "Step 3: Formatting"
echo "------------------"

run_test "Format Check" "pnpm format"

echo "Step 4: Unit Tests"
echo "------------------"

# Note: Org tests require database setup
echo -e "${YELLOW}Note: Org tests require TEST_DATABASE_URL to be set${NC}"
if [ -z "$TEST_DATABASE_URL" ]; then
    echo -e "${YELLOW}⚠ Skipping org tests (TEST_DATABASE_URL not set)${NC}\n"
else
    run_test "Org Router Tests" "pnpm -C packages/api test org.test.ts"
fi

echo "Step 5: File Verification"
echo "-------------------------"

# Check if critical files exist
if [ -f "packages/db/drizzle/0010_certain_sunset_bain.sql" ]; then
    echo -e "${GREEN}✓ Migration file exists${NC}"
    ((TESTS_PASSED++))
else
    echo -e "${RED}✗ Migration file missing${NC}"
    ((TESTS_FAILED++))
fi

if [ -f "apps/map/src/app/_components/phone-action-popover.tsx" ]; then
    echo -e "${GREEN}✓ PhoneActionPopover component exists${NC}"
    ((TESTS_PASSED++))
else
    echo -e "${RED}✗ PhoneActionPopover component missing${NC}"
    ((TESTS_FAILED++))
fi

# Check if phone field is in schema
if grep -q "phone: varchar()" "packages/db/drizzle/schema.ts"; then
    echo -e "${GREEN}✓ Phone field in schema${NC}"
    ((TESTS_PASSED++))
else
    echo -e "${RED}✗ Phone field not in schema${NC}"
    ((TESTS_FAILED++))
fi

echo ""
echo "=================================="
echo "Test Summary"
echo "=================================="
echo -e "Passed: ${GREEN}${TESTS_PASSED}${NC}"
echo -e "Failed: ${RED}${TESTS_FAILED}${NC}"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}All automated tests passed!${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Start the dev server: pnpm dev --filter f3-nation-map"
    echo "2. Open http://localhost:3000"
    echo "3. Test the phone popup manually (see TESTING_GUIDE_PHONE_FIELD.md)"
    echo ""
    exit 0
else
    echo -e "${RED}Some tests failed. Please review the output above.${NC}"
    exit 1
fi
