# Testing Documentation for Phone Field Feature

This directory contains testing documentation for the phone field feature added to the F3 Nation map application.

## Quick Start

### Option 1: Automated Tests (Recommended First)

Run the automated test script:

```bash
# Make sure you're in the repository root
cd /home/runner/work/f3-nation/f3-nation

# Run the test script
./test-phone-changes.sh
```

This will check:
- ✅ Code linting
- ✅ Type checking
- ✅ Formatting
- ✅ Unit tests (if database configured)
- ✅ File existence

**Time:** ~2-3 minutes

---

### Option 2: Manual Testing

After automated tests pass, test the UI:

```bash
# Start the development server
pnpm dev --filter f3-nation-map

# Then follow the checklist
open MANUAL_TEST_CHECKLIST.md
```

**Time:** ~15-20 minutes

---

## Documentation Files

### 📋 [MANUAL_TEST_CHECKLIST.md](./MANUAL_TEST_CHECKLIST.md)
Quick checklist format for manual UI testing. Print it or keep it open while testing.

**Use this for:**
- Manual browser testing
- UI interaction verification
- Cross-browser testing
- Accessibility testing

---

### 📖 [TESTING_GUIDE_PHONE_FIELD.md](./TESTING_GUIDE_PHONE_FIELD.md)
Comprehensive testing guide with detailed steps, SQL queries, and troubleshooting.

**Use this for:**
- Understanding what changed
- Detailed testing procedures
- Database verification
- API testing
- Troubleshooting issues

---

### 🔧 [test-phone-changes.sh](./test-phone-changes.sh)
Automated test script that runs all code quality checks.

**Use this for:**
- Quick validation before manual testing
- CI/CD integration
- Pre-commit checks

---

## Testing Workflow

```
1. Read TESTING_GUIDE_PHONE_FIELD.md (5 min)
   ↓
2. Run ./test-phone-changes.sh (2-3 min)
   ↓
3. Fix any issues found
   ↓
4. Start dev server (pnpm dev --filter f3-nation-map)
   ↓
5. Follow MANUAL_TEST_CHECKLIST.md (15-20 min)
   ↓
6. Document any issues found
   ↓
7. Ready for review!
```

---

## What Changed?

### Database
- Added `phone` field to `orgs` table (nullable varchar)

### API
- Added phone field to org queries and responses
- Added parentPhone and regionPhone to location queries

### UI
- Created PhoneActionPopover component (call/text/copy options)
- Updated ContactLinks to use the popover
- Phone icon appears in contact sections

---

## Prerequisites

### Environment Setup
```bash
# Install dependencies
pnpm install

# Environment variables needed
DATABASE_URL=postgresql://...
TEST_DATABASE_URL=postgresql://...
```

### Required Tools
- Node.js 20.x
- pnpm 8.15.1
- PostgreSQL database
- Modern web browser

---

## Common Issues & Solutions

### Issue: "pnpm: command not found"
```bash
npm install -g pnpm@8.15.1
```

### Issue: "TEST_DATABASE_URL not set"
- Set in your `.env` file
- Or skip database tests (manual testing will still work)

### Issue: "Migration already applied"
- This is normal if you've already run migrations
- Check database: `SELECT * FROM orgs LIMIT 1;`

### Issue: "Popup doesn't appear"
- Check browser console for errors
- Verify org has a phone number in database
- Try hard refresh (Ctrl+Shift+R)

---

## Testing on Different Environments

### Local Development
```bash
# Use .env file
DATABASE_URL=postgresql://localhost:5432/f3nation_dev
```

### Test Environment
```bash
# Use test database
TEST_DATABASE_URL=postgresql://localhost:5432/f3nation_test
pnpm reset-test-db
```

### Production-like
```bash
# Use staging/production database (read-only recommended)
# Only test read operations, not writes
```

---

## CI/CD Integration

Add to your CI pipeline:

```yaml
# .github/workflows/test.yml
- name: Test Phone Field Changes
  run: ./test-phone-changes.sh
```

---

## Success Criteria

✅ **All automated tests pass**
- No linting errors
- No type errors
- No failing unit tests

✅ **Manual tests pass**
- Phone icon appears
- Popup opens/closes correctly
- All three actions work (call/text/copy)

✅ **No regressions**
- Existing features still work
- No console errors
- No performance degradation

---

## Questions?

See the comprehensive guide: [TESTING_GUIDE_PHONE_FIELD.md](./TESTING_GUIDE_PHONE_FIELD.md)

---

## Change Summary

**Files Added:**
- `apps/map/src/app/_components/phone-action-popover.tsx`
- `packages/db/drizzle/0010_certain_sunset_bain.sql`

**Files Modified:**
- `packages/db/drizzle/schema.ts`
- `packages/api/src/router/org.ts`
- `packages/api/src/router/map/location.ts`
- `apps/map/src/app/_components/contact-links.tsx`
- `apps/map/src/app/_components/workout/workout-details-content.tsx`
- `packages/api/src/router/org.test.ts`

**Total Changes:**
- 8 files modified/created
- ~350 lines added
- 1 new UI component
- 1 database migration

---

**Last Updated:** February 7, 2026
