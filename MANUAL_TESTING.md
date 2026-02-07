# Manual Testing Checklist - Phone Field Feature

Quick manual testing guide for the phone field changes.

## Setup
1. Start the dev server: `pnpm dev --filter f3-nation-map`
2. Open http://localhost:3000 in your browser
3. Open Browser DevTools Console (F12)

---

## Things to Test in the App

### 1. Phone Icon Appears
- [ ] Click on any location marker on the map
- [ ] In the event details panel, look for the phone icon (📞) in the contact section
- [ ] Verify the phone icon appears alongside other contact icons (website, email, social media)
- [ ] Check that it appears for both Region and AO contact info (if they have phone numbers)

### 2. Phone Popup Opens
- [ ] Click on the phone icon
- [ ] Verify a popup appears with three options:
  - **Call** (with phone icon)
  - **Text** (with message icon)
  - **Copy** (with copy icon)
- [ ] Popup should be well-positioned near the phone icon

### 3. Test "Call" Action
- [ ] Click phone icon → Click "Call"
- [ ] Your browser should try to open `tel:` link (may show a dialog or open phone app)
- [ ] Popup should close after clicking

### 4. Test "Text" Action
- [ ] Click phone icon → Click "Text"
- [ ] Your browser should try to open `sms:` link (may show a dialog or open messaging app)
- [ ] Popup should close after clicking

### 5. Test "Copy" Action
- [ ] Click phone icon → Click "Copy"
- [ ] A green toast notification should appear: "Phone number copied to clipboard"
- [ ] Test by pasting (Ctrl+V / Cmd+V) - the phone number should be in your clipboard
- [ ] Popup should close after clicking

### 6. Popup Closing
- [ ] Click phone icon to open popup
- [ ] Click outside the popup (on the background)
- [ ] Popup should close
- [ ] Try again: Press ESC key → Popup should close

### 7. Check for Errors
- [ ] Look in the browser console (DevTools)
- [ ] There should be NO red errors related to phone functionality
- [ ] No warnings about missing components or props

### 8. Test Without Phone Number
- [ ] Find an org/location that doesn't have a phone number
- [ ] Verify the phone icon does NOT appear
- [ ] Other contact icons should still work normally

### 9. Mobile/Touch Testing (Optional)
If you have a mobile device or can use DevTools device emulation:
- [ ] Tap the phone icon
- [ ] Verify popup is touch-friendly
- [ ] Test Call/Text/Copy actions on mobile

### 10. Keyboard Navigation (Optional)
- [ ] Use Tab key to navigate to the phone icon
- [ ] Press Enter or Space to open popup
- [ ] Use Tab to move through options
- [ ] Press Enter to activate an option
- [ ] Press ESC to close

---

## Expected Results

✅ **All working correctly if:**
- Phone icon displays when org has a phone number
- Popup opens smoothly when clicking the icon
- All three actions work (Call, Text, Copy)
- Toast notification shows on copy
- Phone number is actually copied to clipboard
- Popup closes properly
- No console errors

❌ **Issues to report if:**
- Phone icon doesn't appear
- Popup doesn't open
- Actions don't work (no tel:/sms: link opens)
- Copy doesn't work or no toast appears
- Console shows errors
- Layout looks broken

---

## Quick Test (2 minutes)
1. Open map → Click location
2. Click phone icon
3. Try Copy action → Verify toast and clipboard
4. Check console for errors
5. Done!

---

## Notes
- Phone field was added to the `orgs` table in the database
- Both Region and AO orgs can have phone numbers
- The popup gives users choice: call, text, or copy the number
- This works on the map's event detail panels

---

Last Updated: February 7, 2026
