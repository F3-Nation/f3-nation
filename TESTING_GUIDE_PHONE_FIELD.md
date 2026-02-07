# Testing Guide for Phone Field Changes

This guide covers all tests you should run locally to verify the phone field functionality changes.

## Summary of Changes

The following changes were made:
1. **Database**: Added `phone` varchar field to `orgs` table
2. **API**: Updated org router to include phone in queries and responses
3. **UI**: Created PhoneActionPopover component with call/text/copy options
4. **UI**: Updated ContactLinks to use the new popover

## Files Changed

### Database & Schema
- `packages/db/drizzle/schema.ts` - Added phone field to orgs table
- `packages/db/drizzle/0010_certain_sunset_bain.sql` - Migration file
- `packages/db/drizzle/meta/_journal.json` - Migration metadata
- `packages/db/drizzle/meta/0010_snapshot.json` - Schema snapshot

### API Layer
- `packages/api/src/router/org.ts` - Added phone to Org interface and queries
- `packages/api/src/router/map/location.ts` - Added parentPhone and regionPhone fields
- `packages/api/src/router/org.test.ts` - Added test for phone field

### UI Layer
- `apps/map/src/app/_components/phone-action-popover.tsx` - New component (CREATED)
- `apps/map/src/app/_components/contact-links.tsx` - Updated to use popover
- `apps/map/src/app/_components/workout/workout-details-content.tsx` - Added phone to contact objects

---

## Testing Checklist

### 1. Environment Setup

```bash
# Ensure dependencies are installed
cd /home/runner/work/f3-nation/f3-nation
pnpm install

# Verify .env file exists with required variables
ls -la .env
```

**Required Environment Variables:**
- `DATABASE_URL` - PostgreSQL connection string
- `TEST_DATABASE_URL` - Test database connection string

---

### 2. Database Migration Tests

#### 2.1 Check Migration File
```bash
# View the migration file
cat packages/db/drizzle/0010_certain_sunset_bain.sql
```

**Verify:**
- ✅ Migration includes `ALTER TABLE "orgs" ADD COLUMN "phone" varchar;`
- ✅ Migration is properly formatted with breakpoints

#### 2.2 Apply Migration (if needed)
```bash
cd packages/db
pnpm with-env drizzle-kit push
# OR
pnpm migrate
```

**Verify:**
- ✅ Migration runs without errors
- ✅ `phone` column appears in database

#### 2.3 Check Database Schema
```bash
# Connect to your database and verify
# Example for PostgreSQL:
psql $DATABASE_URL -c "\d orgs"
```

**Verify:**
- ✅ `phone` column exists in `orgs` table
- ✅ Column type is `varchar`
- ✅ Column is nullable (no NOT NULL constraint)

---

### 3. Code Quality Tests

#### 3.1 Linting
```bash
# Run linting on all changed packages
cd /home/runner/work/f3-nation/f3-nation

# Lint database package
pnpm -C packages/db lint

# Lint API package
pnpm -C packages/api lint

# Lint map app
pnpm -C apps/map lint
```

**Expected:** ✅ No linting errors

#### 3.2 Type Checking
```bash
# Type check all changed packages
cd /home/runner/work/f3-nation/f3-nation

# Type check database package
pnpm -C packages/db typecheck

# Type check API package
pnpm -C packages/api typecheck

# Type check map app
pnpm -C apps/map typecheck
```

**Expected:** ✅ No type errors

#### 3.3 Formatting
```bash
cd /home/runner/work/f3-nation/f3-nation
pnpm format:fix
```

**Expected:** ✅ All files properly formatted

---

### 4. Unit Tests

#### 4.1 API Unit Tests
```bash
cd /home/runner/work/f3-nation/f3-nation/packages/api

# Run org router tests
pnpm test org.test.ts

# Or run with environment variables
pnpm with-env vitest --run org.test.ts
```

**Expected Tests:**
- ✅ `should create org with phone number` - Verifies phone field is saved
- ✅ `should create a new region org` - Existing test still works
- ✅ `should update an existing org` - Updates work with phone field
- ✅ All existing org tests pass

**What to verify:**
1. Creating an org with a phone number stores it correctly
2. Retrieving an org returns the phone field
3. Updating an org preserves or updates the phone field
4. Phone field is nullable (org creation without phone still works)

#### 4.2 Map Component Tests (if applicable)
```bash
cd /home/runner/work/f3-nation/f3-nation/apps/map

# Run all map tests
pnpm test

# Or run specific component tests
pnpm test contact
```

**Note:** Currently no unit tests exist for ContactLinks or PhoneActionPopover.
These should be tested manually (see section 6).

---

### 5. Integration Tests

#### 5.1 API Integration Tests
```bash
cd /home/runner/work/f3-nation/f3-nation/packages/api

# Run all API tests
pnpm test

# Or with specific filter
pnpm test router
```

**Expected:**
- ✅ All location API tests pass (they now include phone fields)
- ✅ All org API tests pass
- ✅ No regressions in existing tests

#### 5.2 E2E Tests (Playwright)
```bash
cd /home/runner/work/f3-nation/f3-nation/apps/map

# Run E2E tests
pnpm test:e2e

# Or run specific test
pnpm test:e2e manage-event-workflow
```

**What to verify:**
- ✅ Map loads without errors
- ✅ Event details panel opens correctly
- ✅ No console errors related to phone field

---

### 6. Manual Testing - UI Components

#### 6.1 Start Development Server
```bash
cd /home/runner/work/f3-nation/f3-nation

# Start the map application
pnpm dev --filter f3-nation-map

# Or
cd apps/map
pnpm dev
```

**Access:** Open http://localhost:3000

#### 6.2 Test PhoneActionPopover Component

**Scenario 1: View Phone Icon**
1. Navigate to the map
2. Click on any location marker
3. Open the event details panel
4. Locate the contact icons section

**Verify:**
- ✅ Phone icon appears alongside other contact icons
- ✅ Phone icon styling matches other icons
- ✅ Phone icon appears for both Region and AO sections (if phone numbers exist)

**Scenario 2: Open Phone Popup**
1. Click on the phone icon
2. A popover should appear with three options

**Verify:**
- ✅ Popover opens on click
- ✅ Popover displays three options: Call, Text, Copy
- ✅ Each option has the correct icon (Phone, MessageSquare, Copy)
- ✅ Popover is positioned correctly near the phone icon
- ✅ Popover styling is consistent with app theme

**Scenario 3: Test Call Action**
1. Click "Call" option in popover
2. Browser should attempt to open tel: protocol

**Verify:**
- ✅ Call action triggers tel: link
- ✅ Popover closes after clicking Call
- ✅ No JavaScript errors in console

**Scenario 4: Test Text Action**
1. Click phone icon again
2. Click "Text" option in popover
3. Browser should attempt to open sms: protocol

**Verify:**
- ✅ Text action triggers sms: link
- ✅ Popover closes after clicking Text
- ✅ No JavaScript errors in console

**Scenario 5: Test Copy Action**
1. Click phone icon again
2. Click "Copy" option in popover

**Verify:**
- ✅ Toast notification appears: "Phone number copied to clipboard"
- ✅ Phone number is actually copied (paste to verify)
- ✅ Popover closes after clicking Copy
- ✅ No JavaScript errors in console

**Scenario 6: Test Clipboard Unavailable**
1. Open browser DevTools
2. In Console, run: `navigator.clipboard = undefined`
3. Click phone icon and try to copy

**Verify:**
- ✅ Toast error appears: "Clipboard not available in this browser"
- ✅ No JavaScript errors thrown

**Scenario 7: Test Popover Close Behavior**
1. Click phone icon to open popover
2. Click outside the popover

**Verify:**
- ✅ Popover closes when clicking outside
- ✅ Popover closes when pressing Escape key

**Scenario 8: Test with No Phone Number**
1. Find an org/location without a phone number
2. View the contact section

**Verify:**
- ✅ Phone icon does not appear
- ✅ Other contact icons still display correctly
- ✅ No layout issues or broken spacing

---

### 7. API Endpoint Testing

#### 7.1 Test Org Endpoints

**Test GET /api/org (list orgs)**
```bash
# Using curl (replace with your actual endpoint)
curl -X GET 'http://localhost:3000/api/org?orgTypes=region&pageIndex=0&pageSize=10' \
  -H 'Content-Type: application/json'
```

**Verify:**
- ✅ Response includes `phone` field in org objects
- ✅ `phone` field is null or has a value
- ✅ Response structure matches expected schema

**Test GET /api/org/:id (single org)**
```bash
# Replace 1 with actual org ID
curl -X GET 'http://localhost:3000/api/org/1' \
  -H 'Content-Type: application/json'
```

**Verify:**
- ✅ Response includes `phone` field
- ✅ Phone value matches database

**Test POST/PUT /api/org (create/update org)**
```bash
# Create org with phone
curl -X POST 'http://localhost:3000/api/org' \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Test Org",
    "orgType": "region",
    "parentId": 1,
    "isActive": true,
    "email": "test@example.com",
    "phone": "+1-555-0123"
  }'
```

**Verify:**
- ✅ Org created successfully with phone
- ✅ Response includes phone field
- ✅ Phone value is saved to database

#### 7.2 Test Location Endpoints

**Test GET /api/map/location/workout (workout details)**
```bash
curl -X GET 'http://localhost:3000/api/map/location/workout?locationId=1' \
  -H 'Content-Type: application/json'
```

**Verify:**
- ✅ Response includes `parentPhone` field
- ✅ Response includes `regionPhone` field
- ✅ Phone values match expected org phone numbers

---

### 8. Database Verification

```sql
-- Connect to your database and run:

-- Check if phone column exists
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'orgs' AND column_name = 'phone';

-- Check sample data
SELECT id, name, email, phone, org_type
FROM orgs
WHERE phone IS NOT NULL
LIMIT 10;

-- Test creating org with phone
INSERT INTO orgs (name, org_type, is_active, phone, parent_id)
VALUES ('Test Org', 'region', true, '+1-555-0123', 1)
RETURNING id, name, phone;

-- Test updating phone
UPDATE orgs
SET phone = '+1-555-9999'
WHERE id = [test_id]
RETURNING id, name, phone;
```

**Verify:**
- ✅ Phone column exists and is varchar
- ✅ Phone is nullable
- ✅ Can insert orgs with phone
- ✅ Can insert orgs without phone (NULL)
- ✅ Can update phone values

---

### 9. Browser Compatibility Testing

Test the phone popup in multiple browsers:

#### Chrome/Edge
- ✅ Popover displays correctly
- ✅ All actions work (call/text/copy)
- ✅ Toast notifications appear

#### Firefox
- ✅ Popover displays correctly
- ✅ All actions work (call/text/copy)
- ✅ Toast notifications appear

#### Safari (if available)
- ✅ Popover displays correctly
- ✅ All actions work (call/text/copy)
- ✅ Toast notifications appear

#### Mobile Browsers
- ✅ Popover is touch-friendly
- ✅ Call/Text actions work on mobile devices
- ✅ Copy works on mobile

---

### 10. Accessibility Testing

#### Keyboard Navigation
1. Use Tab key to navigate to phone icon
2. Press Enter/Space to open popover
3. Use Tab to navigate through options
4. Press Enter on an option

**Verify:**
- ✅ Phone button is keyboard focusable
- ✅ Popover opens with keyboard
- ✅ Can navigate popup with Tab
- ✅ Can activate options with Enter/Space
- ✅ Escape key closes popover

#### Screen Reader
1. Enable screen reader (VoiceOver, NVDA, etc.)
2. Navigate to phone icon

**Verify:**
- ✅ Phone button has proper aria-label: "Phone"
- ✅ Screen reader announces button purpose
- ✅ Popover content is accessible
- ✅ Action buttons are properly labeled

---

### 11. Error Handling Tests

#### Test Invalid Phone Numbers
1. Create/update org with various phone formats:
   - Valid: "+1-555-0123"
   - Valid: "5550123"
   - Valid: "(555) 012-3456"
   - Empty string: ""
   - NULL

**Verify:**
- ✅ All formats are accepted (no validation on phone field)
- ✅ Empty strings are stored
- ✅ NULL values are handled correctly

#### Test API Error Scenarios
1. Try to create org without required fields
2. Try to access non-existent org

**Verify:**
- ✅ Appropriate error messages
- ✅ Phone field doesn't cause additional errors
- ✅ Error handling remains consistent

---

### 12. Performance Testing

#### Load Time
1. Open Chrome DevTools > Network tab
2. Load a page with phone numbers
3. Check network requests

**Verify:**
- ✅ No additional network requests for phone functionality
- ✅ Page load time not significantly impacted
- ✅ No memory leaks from popover component

#### Large Dataset
1. Load page with many orgs/locations
2. Check performance

**Verify:**
- ✅ Rendering remains smooth
- ✅ Phone popover doesn't cause lag
- ✅ No performance degradation

---

## Quick Test Script

Run this script for a quick validation:

```bash
#!/bin/bash
cd /home/runner/work/f3-nation/f3-nation

echo "=== Running Quick Test Suite ==="

echo "\n1. Linting..."
pnpm -C packages/db lint && \
pnpm -C packages/api lint && \
pnpm -C apps/map lint

echo "\n2. Type Checking..."
pnpm -C packages/db typecheck && \
pnpm -C packages/api typecheck && \
pnpm -C apps/map typecheck

echo "\n3. Running API Tests..."
pnpm -C packages/api test org.test.ts

echo "\n4. Formatting Check..."
pnpm format

echo "\n=== Test Suite Complete ==="
```

Save as `test-phone-changes.sh` and run with:
```bash
chmod +x test-phone-changes.sh
./test-phone-changes.sh
```

---

## Troubleshooting

### Issue: Tests fail with database errors
**Solution:** 
- Ensure TEST_DATABASE_URL is set
- Run `pnpm reset-test-db` in packages/db
- Check database is accessible

### Issue: Popover doesn't appear
**Solution:**
- Check browser console for errors
- Verify phone field has a value
- Check if Radix UI dependencies are installed

### Issue: Copy doesn't work
**Solution:**
- Ensure using HTTPS (clipboard API requirement)
- Check browser supports clipboard API
- Verify no Content Security Policy blocking clipboard

### Issue: Migration fails
**Solution:**
- Check if migration already applied
- Verify database connection
- Review migration file for syntax errors

---

## Reporting Issues

If you find any issues during testing:

1. **Document the issue:**
   - What you were testing
   - Expected behavior
   - Actual behavior
   - Error messages/screenshots

2. **Check the following:**
   - Browser console for errors
   - Network tab for failed requests
   - Database state
   - Server logs

3. **Provide details:**
   - Browser and version
   - Operating system
   - Node version
   - Database version

---

## Success Criteria

All tests pass when:

- ✅ Database migration applied successfully
- ✅ All linting passes
- ✅ All type checking passes
- ✅ All unit tests pass
- ✅ API returns phone field correctly
- ✅ Phone icon appears in UI
- ✅ Phone popup opens and closes correctly
- ✅ All three actions work (call/text/copy)
- ✅ No console errors
- ✅ No accessibility issues
- ✅ Works across browsers
- ✅ No performance degradation

---

## Additional Resources

- **Drizzle ORM Docs:** https://orm.drizzle.team/
- **Radix UI Popover:** https://www.radix-ui.com/primitives/docs/components/popover
- **Lucide Icons:** https://lucide.dev/
- **Vitest Docs:** https://vitest.dev/

---

**Last Updated:** 2026-02-07
**Changes:** Phone field added to orgs table with popup UI
