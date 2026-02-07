# Testing Plan for Location Name Changes

## Overview
This document outlines comprehensive testing strategies for the Location Name field changes across both the admin portal and map application.

## Changes Summary

### 1. Map Location Form (copilot/add-location-name-to-map-form)
- **Added**: Location Name input field to the map's location form
- **Files Modified**:
  - `apps/map/src/app/_components/forms/location-event-form.tsx`
  - `apps/map/src/app/_components/modal/update-location-modal.tsx`
  - `apps/map/src/utils/store/modal.ts`

### 2. Admin Portal Validation (copilot/make-location-name-required)
- **Added**: Validation requiring Location Name in admin portal
- **Files Modified**:
  - `packages/validators/src/index.ts`
  - `apps/map/src/app/_components/modal/admin-locations-modal.tsx`
  - `packages/api/src/router/location.test.ts`

---

## 1. Unit Tests

### 1.1 Validator Tests
**Location**: `packages/validators/src/`

#### Test: LocationInsertSchema Validation
```typescript
describe('LocationInsertSchema', () => {
  it('should require name field', () => {
    const result = LocationInsertSchema.safeParse({
      orgId: 1,
      isActive: true,
      // name is missing
    });
    expect(result.success).toBe(false);
  });

  it('should reject empty string for name', () => {
    const result = LocationInsertSchema.safeParse({
      name: '',
      orgId: 1,
      isActive: true,
    });
    expect(result.success).toBe(false);
  });

  it('should reject whitespace-only name', () => {
    const result = LocationInsertSchema.safeParse({
      name: '   ',
      orgId: 1,
      isActive: true,
    });
    expect(result.success).toBe(false);
  });

  it('should accept valid name', () => {
    const result = LocationInsertSchema.safeParse({
      name: 'Freedom Park',
      orgId: 1,
      isActive: true,
    });
    expect(result.success).toBe(true);
  });
});
```

**Run Command**: 
```bash
cd packages/validators && pnpm test
```

---

## 2. API Tests

### 2.1 Location Router Tests
**Location**: `packages/api/src/router/location.test.ts`

#### Existing Tests to Verify
- ✅ Test already added: "should require name" (tests empty string and whitespace)

#### Additional Tests to Run
```bash
cd packages/api && pnpm test location.test.ts
```

**Expected Results**:
- All location creation tests should pass
- Name requirement validation should trigger correctly
- Empty/whitespace names should be rejected

### 2.2 Update Request Tests
Test the update request flow for location name:

```bash
# Test that locationName is properly handled in update requests
cd packages/api && pnpm test request.test.ts
```

---

## 3. Integration Tests

### 3.1 Admin Portal Location Creation Flow
**Test Scenario**: Create location through admin portal

**Steps**:
1. Navigate to `/admin/locations`
2. Click "Add Location" button
3. Select a region
4. Attempt to save WITHOUT entering a name
5. Verify validation error appears: "Name is required"
6. Enter a valid name (e.g., "Freedom Park")
7. Complete other required fields
8. Submit form
9. Verify location is created successfully

**Expected Behavior**:
- Form should NOT submit without a name
- Error message should display below name field
- Placeholder text should show: "Commonly known as (e.g., Freedom Park)"

### 3.2 Admin Portal Location Editing Flow
**Test Scenario**: Edit existing location

**Steps**:
1. Navigate to `/admin/locations`
2. Click edit on an existing location
3. Clear the name field
4. Attempt to save
5. Verify validation error appears
6. Re-enter a name
7. Submit form
8. Verify changes are saved

**Expected Behavior**:
- Cannot save with empty name
- Existing name should populate field on load
- Validation should work same as creation

### 3.3 Map Location Form Flow
**Test Scenario**: Add location from map

**Steps**:
1. Navigate to map view
2. Click to add a new location/workout
3. Verify "Location Name" field appears in the form
4. Enter a location name (e.g., "Freedom Park")
5. Enter other location details (address, city, etc.)
6. Submit the form
7. Verify locationName is included in the request

**Expected Behavior**:
- Location Name field appears before Location Description
- Field is optional (no asterisk)
- Placeholder shows: "Commonly known as (e.g., Freedom Park)"
- Value is saved and sent with the request

### 3.4 Map Location Edit Flow
**Test Scenario**: Edit location from map

**Steps**:
1. Navigate to map view
2. Click to edit an existing workout/location
3. Verify Location Name field shows existing value
4. Modify the location name
5. Submit the form
6. Verify changes are saved

**Expected Behavior**:
- Existing location name should populate
- Can modify or clear the name (optional field)
- Changes are saved correctly

---

## 4. Manual UI Testing

### 4.1 Admin Portal UI Tests

#### Test Case 1: Visual Verification
- [ ] Name field label is visible and clear
- [ ] Placeholder text displays correctly
- [ ] Tooltip icon appears next to label
- [ ] Tooltip shows: "The name of the location (not the AO)"
- [ ] Error message styling is consistent with other fields

#### Test Case 2: Form Behavior
- [ ] Cursor focuses on field when clicked
- [ ] Text entry works normally
- [ ] Copy/paste works correctly
- [ ] Tab navigation works correctly
- [ ] Enter key doesn't submit form prematurely

#### Test Case 3: Validation Messages
- [ ] Error appears immediately when trying to submit without name
- [ ] Error clears when valid name is entered
- [ ] Error message is user-friendly
- [ ] Multiple validation errors display correctly

### 4.2 Map App UI Tests

#### Test Case 4: Field Visibility
- [ ] Location Name field appears in the form
- [ ] Field is positioned before Location Description
- [ ] Field takes proper width in 2-column grid
- [ ] Label text is clear: "Location Name"
- [ ] Placeholder text is helpful

#### Test Case 5: Form Layout
- [ ] Form layout is not broken
- [ ] All fields align properly
- [ ] Responsive design works on mobile
- [ ] Scrolling works if form is long
- [ ] No visual overlaps or cutoffs

#### Test Case 6: Data Flow
- [ ] Entered value appears in request payload
- [ ] Value persists after form refresh (if applicable)
- [ ] Value displays correctly when editing
- [ ] Value is cleared when creating new location

---

## 5. Browser Compatibility Tests

### Desktop Browsers
- [ ] Chrome (latest)
- [ ] Firefox (latest)
- [ ] Safari (latest)
- [ ] Edge (latest)

### Mobile Browsers
- [ ] Chrome Mobile
- [ ] Safari iOS
- [ ] Samsung Internet

### Test Points for Each Browser:
1. Field renders correctly
2. Validation works
3. Error messages display
4. Form submission works
5. No console errors

---

## 6. Regression Tests

### 6.1 Existing Location Features
Ensure these still work:

- [ ] Location listing in admin portal
- [ ] Location search/filtering
- [ ] Location deletion
- [ ] Location activation/deactivation
- [ ] Location dropdown in event forms
- [ ] Location display on map markers
- [ ] Location details in workout details modal

### 6.2 Related Features
- [ ] Workout creation with locations
- [ ] Workout editing with locations
- [ ] AO association with locations
- [ ] Region filtering for locations
- [ ] Update request submission
- [ ] Admin approval of location updates

---

## 7. Performance Tests

### 7.1 Load Time
- [ ] Form loads within acceptable time (<1s)
- [ ] No noticeable delay when opening modal
- [ ] Validation happens quickly (feels instant)

### 7.2 Large Dataset Handling
- [ ] Location dropdown performs well with 1000+ locations
- [ ] Form handles long location names (100+ characters)
- [ ] Search/filter remains responsive

---

## 8. Edge Cases & Error Handling

### 8.1 Input Validation Edge Cases
- [ ] Name with special characters: `Test & Location #1`
- [ ] Name with unicode: `Café René`
- [ ] Very long name: 255+ characters
- [ ] Name with leading/trailing spaces
- [ ] Name with only spaces
- [ ] Name with only numbers: `12345`
- [ ] Name with emojis: `Park 🏃‍♂️`

### 8.2 Network Error Handling
- [ ] Submit fails gracefully with network error
- [ ] Retry works after network error
- [ ] Form data persists after error
- [ ] User-friendly error message displays

### 8.3 Concurrent Edit Scenarios
- [ ] Two users editing same location
- [ ] Location deleted while editing
- [ ] Location updated by admin while user editing

---

## 9. Accessibility Tests

### 9.1 Keyboard Navigation
- [ ] Can tab to name field
- [ ] Can tab away from name field
- [ ] Enter key behavior is correct
- [ ] Escape key closes modal

### 9.2 Screen Reader Support
- [ ] Label is properly associated with input
- [ ] Error messages are announced
- [ ] Placeholder text is accessible
- [ ] Required field is indicated to screen reader

### 9.3 Visual Accessibility
- [ ] Sufficient color contrast
- [ ] Error states are visible (not color-only)
- [ ] Focus indicators are visible
- [ ] Text is readable at various zoom levels

---

## 10. Data Integrity Tests

### 10.1 Database Verification
```sql
-- Verify location name is stored correctly
SELECT id, name, org_id, is_active 
FROM locations 
WHERE created > NOW() - INTERVAL '1 day'
ORDER BY created DESC
LIMIT 10;

-- Check for locations without names (should be none in admin-created)
SELECT COUNT(*) 
FROM locations 
WHERE name IS NULL OR name = '';
```

### 10.2 API Response Verification
- [ ] Location name in API responses
- [ ] Update request includes locationName
- [ ] Location queries return name correctly

---

## 11. Test Execution Checklist

### Pre-Testing Setup
- [ ] Ensure test database is seeded
- [ ] Have test user accounts (admin, editor, regular)
- [ ] Clear browser cache
- [ ] Note current environment (dev/staging/prod)

### Automated Tests
```bash
# Run all validator tests
cd packages/validators && pnpm test

# Run all API tests
cd packages/api && pnpm test

# Run location-specific tests
cd packages/api && pnpm test location.test.ts

# Run lint checks
pnpm lint

# Run type checks
pnpm typecheck

# Run format checks
pnpm format
```

### Manual Testing Order
1. **Unit Tests** (automated) - 5 minutes
2. **API Tests** (automated) - 10 minutes
3. **Admin Portal Tests** (manual) - 20 minutes
4. **Map App Tests** (manual) - 20 minutes
5. **Regression Tests** (manual) - 30 minutes
6. **Edge Cases** (manual) - 15 minutes

**Total Estimated Time**: ~100 minutes

---

## 12. Test Results Template

### Test Run: [Date]
**Tester**: [Name]
**Environment**: [dev/staging/prod]
**Branch**: [branch-name]

#### Summary
- Tests Passed: __ / __
- Tests Failed: __ / __
- Tests Skipped: __ / __

#### Failed Tests
| Test Case | Expected | Actual | Severity | Notes |
|-----------|----------|--------|----------|-------|
|           |          |        |          |       |

#### Screenshots
- [ ] Admin portal - Name field empty state
- [ ] Admin portal - Name field with value
- [ ] Admin portal - Validation error state
- [ ] Map app - Name field in form
- [ ] Map app - Form with name filled

#### Issues Found
1. 
2. 
3. 

#### Sign-off
- [ ] All critical tests passed
- [ ] No blocking issues found
- [ ] Ready for deployment

---

## 13. Quick Smoke Test (5 minutes)

For quick verification before deployment:

```bash
# 1. Run critical tests
cd packages/api && pnpm test location.test.ts

# 2. Test admin portal manually
# - Navigate to /admin/locations
# - Try to create location without name (should fail)
# - Create location with name (should succeed)

# 3. Test map app manually
# - Open map
# - Add new location
# - Verify name field appears and works

# 4. Check console for errors
# - No errors in browser console
# - No errors in server logs
```

---

## 14. Deployment Validation

### Post-Deployment Checks
After deploying to staging/production:

- [ ] Smoke test passes (see section 13)
- [ ] No new errors in Sentry/error tracking
- [ ] No increase in API error rates
- [ ] User metrics remain stable
- [ ] Monitor for 24 hours

### Rollback Criteria
Rollback immediately if:
- Critical functionality is broken
- Data corruption occurs
- >5% error rate increase
- Security vulnerability discovered

---

## Contact & Support

**Questions about testing?** 
Contact: [Your Team]

**Found a bug?**
1. Document it thoroughly
2. Create GitHub issue
3. Notify team immediately if critical

**Need help running tests?**
See: `README.md` and `CONTRIBUTING.md`

---

## Appendix A: Test Data

### Sample Location Names for Testing
```
Valid:
- "Freedom Park"
- "Myers Park Community Center"
- "Lake Norman State Park"
- "Downtown Charlotte - Main St"

Edge Cases:
- "A" (single character)
- "This is a very long location name that might cause issues with display or database storage"
- "名前テスト" (Unicode characters)
- "O'Brien's Café & Grill" (Special characters)

Invalid (for admin portal):
- "" (empty string)
- "   " (whitespace only)
- null
```

### Sample Test Regions
```
- "Charlotte" (orgId: 1)
- "Raleigh" (orgId: 2)
- "Durham" (orgId: 3)
```

---

## Appendix B: Common Issues & Solutions

### Issue: Tests failing locally
**Solution**: 
```bash
# Reset test database
pnpm reset-test-db

# Reinstall dependencies
pnpm install

# Clear cache
rm -rf node_modules/.cache
```

### Issue: Form not showing name field
**Solution**: Check that you're on the correct branch and changes are built

### Issue: Validation not working
**Solution**: Verify validator schema is properly imported and form is using correct schema

---

**Document Version**: 1.0
**Last Updated**: [Current Date]
**Maintained By**: Development Team
