# Quick Testing Checklist for Location Name Changes

## 🚀 Quick Start (5 minutes)

### Automated Tests
```bash
# Run the automated test suite
./test-location-changes.sh

# Or run individual test suites:
cd packages/api && pnpm test location.test.ts
cd packages/validators && pnpm test
```

---

## ✅ Manual Testing Checklist

### Admin Portal Location Creation
**URL**: `/admin/locations`

- [ ] **Test 1: Empty Name Validation**
  - Click "Add Location"
  - Select a region
  - Leave name field empty
  - Click "Save Changes"
  - ✓ Expect: Error message "Name is required"

- [ ] **Test 2: Whitespace Name Validation**
  - Enter only spaces "   " in name field
  - Click "Save Changes"
  - ✓ Expect: Error message "Name is required"

- [ ] **Test 3: Valid Name Creation**
  - Enter "Freedom Park" in name field
  - Fill other required fields
  - Click "Save Changes"
  - ✓ Expect: Location created successfully
  - ✓ Expect: Toast notification appears
  - ✓ Expect: Modal closes

- [ ] **Test 4: Placeholder Text**
  - Open add location modal
  - ✓ Expect: Placeholder shows "Commonly known as (e.g., Freedom Park)"

### Map Location Form
**URL**: `/` (map view)

- [ ] **Test 5: Field Visibility**
  - Click on map to add location/workout
  - ✓ Expect: "Location Name" field appears
  - ✓ Expect: Field is before "Location Description"
  - ✓ Expect: Placeholder shows "Commonly known as (e.g., Freedom Park)"

- [ ] **Test 6: Optional Field Behavior**
  - Leave location name empty
  - Fill other fields
  - Click "Save Changes"
  - ✓ Expect: Form submits successfully (field is optional)

- [ ] **Test 7: Name Persistence**
  - Enter "Myers Park" in location name
  - Fill other fields and submit
  - ✓ Expect: Request includes locationName in payload

- [ ] **Test 8: Edit Existing Location**
  - Edit a workout with existing location
  - ✓ Expect: Location name field shows current value
  - ✓ Expect: Can modify the name
  - Submit changes
  - ✓ Expect: Changes are saved

### Visual/UI Verification

- [ ] **Test 9: Layout Check**
  - Form fields align properly
  - No overlapping text
  - Responsive on mobile (< 768px width)
  - Scrolling works if needed

- [ ] **Test 10: Error State**
  - Trigger validation error (admin portal)
  - ✓ Expect: Red error text below field
  - ✓ Expect: Field border color changes
  - Enter valid name
  - ✓ Expect: Error clears immediately

### Regression Testing

- [ ] **Test 11: Location Dropdown**
  - Open event creation form
  - ✓ Expect: Location dropdown still works
  - ✓ Expect: Locations show their names
  - ✓ Expect: No blank entries in dropdown

- [ ] **Test 12: Location Listing**
  - Go to `/admin/locations`
  - ✓ Expect: All locations display with names
  - ✓ Expect: Search/filter works
  - ✓ Expect: No visual issues

---

## 🔍 Quick Smoke Test (2 minutes)

Run these tests before any deployment:

1. **Admin Portal**:
   ```
   ✓ Can create location with name
   ✓ Cannot create location without name
   ```

2. **Map App**:
   ```
   ✓ Location name field appears
   ✓ Field accepts input
   ✓ Form submits successfully
   ```

3. **No Errors**:
   ```
   ✓ No console errors
   ✓ No network errors
   ✓ No visual glitches
   ```

---

## 🐛 Bug Reporting Template

If you find an issue:

```markdown
**Test**: [Test number/name]
**Expected**: [What should happen]
**Actual**: [What actually happened]
**Steps to Reproduce**:
1. 
2. 
3. 

**Environment**:
- Browser: 
- Device: 
- URL: 

**Screenshot**: [Attach if applicable]
```

---

## 📊 Sign-off

When all tests pass:

- [ ] All automated tests passed
- [ ] All manual tests passed
- [ ] No critical bugs found
- [ ] Screenshots taken (if UI changes)
- [ ] Ready for code review/deployment

**Tested by**: _______________
**Date**: _______________
**Branch**: _______________

---

## 🆘 Need Help?

- **Full Testing Guide**: See `TESTING_PLAN.md`
- **Run Automated Tests**: `./test-location-changes.sh`
- **Issues**: Create a GitHub issue
