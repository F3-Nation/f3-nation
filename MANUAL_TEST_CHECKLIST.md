# Manual Testing Checklist - Phone Field

Use this checklist when manually testing the phone field functionality in the browser.

## Prerequisites
- [ ] Development server is running (`pnpm dev --filter f3-nation-map`)
- [ ] Browser is open to http://localhost:3000
- [ ] Browser DevTools Console is open (F12)

---

## Test 1: Phone Icon Display

### Steps:
1. Navigate to the map
2. Click on any location marker to open event details
3. Look at the contact section

### Verify:
- [ ] Phone icon appears in the contact section (if org has phone)
- [ ] Phone icon matches style of other contact icons (website, email, etc.)
- [ ] Phone icon appears for both:
  - [ ] Region contact info
  - [ ] AO contact info (if they have phone numbers)
- [ ] Icons are properly aligned
- [ ] No console errors

---

## Test 2: Open Phone Popup

### Steps:
1. Click on the phone icon

### Verify:
- [ ] Popup appears immediately
- [ ] Popup is positioned near the phone icon
- [ ] Popup contains three options:
  - [ ] "Call" with phone icon
  - [ ] "Text" with message icon
  - [ ] "Copy" with copy icon
- [ ] Popup has clean styling consistent with app
- [ ] No console errors

---

## Test 3: Call Action

### Steps:
1. Click phone icon to open popup
2. Click "Call" option

### Verify:
- [ ] Browser attempts to open tel: protocol (or shows dialog)
- [ ] Popup closes after clicking
- [ ] No console errors

---

## Test 4: Text Action

### Steps:
1. Click phone icon to open popup
2. Click "Text" option

### Verify:
- [ ] Browser attempts to open sms: protocol (or shows dialog)
- [ ] Popup closes after clicking
- [ ] No console errors

---

## Test 5: Copy Action

### Steps:
1. Click phone icon to open popup
2. Click "Copy" option
3. Paste into a text editor (Ctrl+V or Cmd+V)

### Verify:
- [ ] Green toast notification appears: "Phone number copied to clipboard"
- [ ] Phone number is actually in clipboard (paste works)
- [ ] Popup closes after clicking
- [ ] No console errors

---

## Test 6: Popup Close Behavior

### Steps:
1. Click phone icon to open popup
2. Click outside the popup (on the background)

### Verify:
- [ ] Popup closes

### Steps:
1. Click phone icon to open popup
2. Press ESC key

### Verify:
- [ ] Popup closes

---

## Test 7: No Phone Number

### Steps:
1. Find an org/location that doesn't have a phone number
2. View the contact section

### Verify:
- [ ] Phone icon does NOT appear
- [ ] Other contact icons still display correctly
- [ ] No broken layout or spacing issues

---

## Test 8: Mobile Testing (if available)

### Steps:
1. Open site on mobile device or use DevTools device emulation
2. Click on location to open event details
3. Tap phone icon

### Verify:
- [ ] Popup appears and is touch-friendly
- [ ] All three options are tappable
- [ ] Call action works on mobile (opens phone app)
- [ ] Text action works on mobile (opens messaging app)
- [ ] Copy action works on mobile

---

## Test 9: Keyboard Accessibility

### Steps:
1. Use Tab key to navigate to phone icon
2. Press Enter or Space to activate

### Verify:
- [ ] Phone button receives focus (visible focus ring)
- [ ] Enter/Space opens popup
- [ ] Can Tab through popup options
- [ ] Enter activates focused option
- [ ] ESC closes popup

---

## Test 10: Different Browsers

Test in each browser you have available:

### Chrome
- [ ] All tests pass

### Firefox
- [ ] All tests pass

### Safari (if available)
- [ ] All tests pass

### Edge
- [ ] All tests pass

---

## Test 11: Console Errors

Throughout ALL tests above:

### Verify:
- [ ] No JavaScript errors in console
- [ ] No warning messages about missing dependencies
- [ ] No network errors related to phone functionality

---

## Test 12: Performance

### Steps:
1. Open DevTools > Performance tab
2. Record while interacting with phone popup
3. Stop recording

### Verify:
- [ ] No significant performance issues
- [ ] Popup opens/closes smoothly
- [ ] No memory leaks

---

## Issues Found

If you find any issues, document them here:

**Issue 1:**
- Description: 
- Steps to reproduce:
- Expected behavior:
- Actual behavior:
- Screenshot/Error message:

**Issue 2:**
- Description: 
- Steps to reproduce:
- Expected behavior:
- Actual behavior:
- Screenshot/Error message:

---

## Sign-off

- [ ] All tests completed
- [ ] All tests passed OR issues documented
- [ ] Ready for code review/merge

Tested by: ___________________
Date: ___________________
Browser(s): ___________________

---

**Total Tests:** 12 categories
**Estimated Time:** 15-20 minutes
