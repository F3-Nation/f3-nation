# Manual Testing Checklist for Location Name Changes

## Quick Overview
Test the Location Name field changes in both the admin portal and map app.

---

## Admin Portal Testing (/admin/locations)

### Test 1: Create Location Without Name (Should Fail)
- [ ] Navigate to `/admin/locations`
- [ ] Click "Add Location" button
- [ ] Select any region
- [ ] **Leave the name field empty**
- [ ] Click "Save Changes"
- [ ] **Expected**: Error message "Name is required" appears
- [ ] **Expected**: Form does NOT submit

### Test 2: Create Location With Whitespace Only (Should Fail)
- [ ] Navigate to `/admin/locations`
- [ ] Click "Add Location" button  
- [ ] Select any region
- [ ] Enter only spaces "   " in the name field
- [ ] Click "Save Changes"
- [ ] **Expected**: Error message "Name is required" appears
- [ ] **Expected**: Form does NOT submit

### Test 3: Create Location With Valid Name (Should Succeed)
- [ ] Navigate to `/admin/locations`
- [ ] Click "Add Location" button
- [ ] Select any region
- [ ] Enter "Freedom Park" in the name field
- [ ] Fill in other required fields (latitude, longitude)
- [ ] Click "Save Changes"
- [ ] **Expected**: Location created successfully
- [ ] **Expected**: Success toast notification appears
- [ ] **Expected**: Modal closes

### Test 4: Edit Existing Location
- [ ] Navigate to `/admin/locations`
- [ ] Click edit on an existing location
- [ ] Verify the name field shows the current name
- [ ] Modify the name to something else
- [ ] Click "Save Changes"
- [ ] **Expected**: Changes are saved successfully

### Test 5: Verify Placeholder Text
- [ ] Open the add location modal
- [ ] Check the name field placeholder text
- [ ] **Expected**: Shows "Commonly known as (e.g., Freedom Park)"

---

## Map App Testing (/ - map view)

### Test 6: Location Name Field Appears
- [ ] Navigate to the map view
- [ ] Click on the map to add a new location/workout
- [ ] Look for the "Location Name" field in the form
- [ ] **Expected**: Field is visible
- [ ] **Expected**: Field is positioned before "Location Description"
- [ ] **Expected**: Placeholder shows "Commonly known as (e.g., Freedom Park)"

### Test 7: Create Location With Name
- [ ] Open the location form on the map
- [ ] Enter "Myers Park" in the Location Name field
- [ ] Fill in other required fields (address, city, etc.)
- [ ] Submit the form
- [ ] **Expected**: Form submits successfully
- [ ] **Expected**: Location name is included in the request

### Test 8: Create Location Without Name (Optional Field)
- [ ] Open the location form on the map
- [ ] **Leave the Location Name field empty**
- [ ] Fill in other required fields
- [ ] Submit the form
- [ ] **Expected**: Form submits successfully (name is optional here)

### Test 9: Edit Existing Location from Map
- [ ] Click on an existing location/workout on the map
- [ ] Open the edit form
- [ ] Verify the Location Name field shows the current value (if exists)
- [ ] Modify or add a location name
- [ ] Submit the form
- [ ] **Expected**: Changes are saved successfully

---

## Regression Testing

### Test 10: Location Dropdown Works
- [ ] Open any form with a location dropdown
- [ ] Click the dropdown to view locations
- [ ] **Expected**: All locations show their names
- [ ] **Expected**: No blank entries in the dropdown
- [ ] **Expected**: Locations are searchable/filterable

### Test 11: Location Listing Still Works
- [ ] Navigate to `/admin/locations`
- [ ] Verify the locations table displays
- [ ] **Expected**: All locations show with their names
- [ ] **Expected**: Search functionality works
- [ ] **Expected**: Pagination works (if applicable)

### Test 12: No Console Errors
- [ ] Open browser developer console (F12)
- [ ] Perform tests 1-9
- [ ] **Expected**: No JavaScript errors in console
- [ ] **Expected**: No network request failures

---

## Browser Testing (Optional but Recommended)

Test in at least 2 browsers:
- [ ] Chrome/Edge - All tests pass
- [ ] Firefox - All tests pass
- [ ] Safari - All tests pass (if available)

---

## Test Results

**Date Tested**: _______________  
**Tested By**: _______________  
**Environment**: [dev/staging/prod]

### Summary
- Tests Passed: __ / 12
- Tests Failed: __ / 12
- Critical Issues Found: __ 

### Issues Found
1. 
2. 
3. 

### Screenshots
- [ ] Admin portal - Name validation error
- [ ] Admin portal - Successful creation
- [ ] Map app - Location Name field
- [ ] Location dropdown showing names

---

## Sign-off

- [ ] All critical tests passed (Tests 1, 3, 6, 10)
- [ ] No blocking issues found
- [ ] Ready for deployment

**Approved by**: _______________  
**Date**: _______________
