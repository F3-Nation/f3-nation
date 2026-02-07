# Testing Areas Diagram

## Architecture Overview - What to Test

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         F3 Nation Application                            │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────┐        ┌─────────────────────┐
│   Admin Portal      │        │     Map App         │
│   /admin/locations  │        │     / (map view)    │
└──────────┬──────────┘        └──────────┬──────────┘
           │                              │
           │ [1] Location Name            │ [2] Location Name
           │     Field (Required)         │     Field (Optional)
           │                              │
           ▼                              ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     Location Event Form Component                       │
│  File: apps/map/src/app/_components/forms/location-event-form.tsx     │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │ Location Name: [________________] ← NEW FIELD                    │ │
│  │ Placeholder: "Commonly known as (e.g., Freedom Park)"            │ │
│  └──────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
           │
           │ Form Submission
           │
           ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      Modal Store & Type System                          │
│  File: apps/map/src/utils/store/modal.ts                              │
│                                                                         │
│  • locationDefaults: { locationName: "" }                              │
│  • DataType interface: locationName: string | null                     │
│  • eventAndLocationToUpdateRequest: maps locationName                  │
└────────────────────────────────────────────────────────────────────────┘
           │
           │ API Request
           │
           ▼
┌────────────────────────────────────────────────────────────────────────┐
│                         Validators Layer                                │
│  File: packages/validators/src/index.ts                               │
│                                                                         │
│  LocationInsertSchema:                                                 │
│  ✓ name: min(1) + regex(/\S/) - requires non-whitespace              │
│  ✓ Error: "Name is required"                                          │
│                                                                         │
│  RequestInsertSchema:                                                  │
│  • locationName: optional (for map form)                               │
└────────────────────────────────────────────────────────────────────────┘
           │
           │ Validated Data
           │
           ▼
┌────────────────────────────────────────────────────────────────────────┐
│                         API Router Layer                                │
│  File: packages/api/src/router/location.ts                            │
│                                                                         │
│  Endpoints tested:                                                     │
│  • POST /location/crupdate - Location creation/update                 │
│  • GET  /location/all      - Location listing                         │
│  • GET  /location/byId     - Location details                         │
└────────────────────────────────────────────────────────────────────────┘
           │
           │ Database Query
           │
           ▼
┌────────────────────────────────────────────────────────────────────────┐
│                         Database Layer                                  │
│  Schema: packages/db/drizzle/schema.ts                                │
│                                                                         │
│  locations table:                                                      │
│  • name: varchar().notNull() ← Already enforced at DB level           │
│                                                                         │
│  update_requests table:                                                │
│  • location_name: varchar() ← Nullable for map form                   │
└────────────────────────────────────────────────────────────────────────┘
```

## Test Flow Diagram

```
User Action                Test Point              Expected Outcome
───────────────────────────────────────────────────────────────────────

[Admin Portal Flow]
1. Click "Add Location"  →  Modal Opens          →  ✓ Form displays
2. Select Region         →  Field Updates        →  ✓ Region selected
3. Leave Name Empty      →  Click Submit         →  ✗ Error: "Name is required"
4. Enter "   "           →  Click Submit         →  ✗ Error: "Name is required"
5. Enter "Freedom Park"  →  Validation           →  ✓ Valid input
6. Click Submit          →  API Call             →  ✓ Location created
7. Check Database        →  Query Result         →  ✓ Name stored correctly

[Map App Flow]
1. Click on Map          →  Modal Opens          →  ✓ Form displays
2. See Location Name     →  Field Visibility     →  ✓ Field appears
3. Enter "Myers Park"    →  Input Handling       →  ✓ Text entered
4. Leave Field Empty     →  Optional Check       →  ✓ Can submit without name
5. Click Submit          →  API Call             →  ✓ Request sent
6. Check Payload         →  Data Inspection      →  ✓ locationName included

[Integration Tests]
1. Create via Admin      →  Appears on Map       →  ✓ Location visible
2. Edit via Map          →  Updates Database     →  ✓ Changes saved
3. Dropdown Selection    →  Shows Names          →  ✓ No blank entries
4. Search Locations      →  By Name              →  ✓ Search works
```

## Test Coverage Map

```
Component/Layer               Test Type            Priority    Status
──────────────────────────────────────────────────────────────────────
LocationInsertSchema          Unit Test            HIGH        [ ]
RequestInsertSchema           Unit Test            MEDIUM      [ ]
location.crupdate             API Test             HIGH        [✓]
location.all                  API Test             MEDIUM      [ ]
Admin Location Modal          UI Test              HIGH        [ ]
Map Location Form             UI Test              HIGH        [ ]
modal.ts Types                Type Check           HIGH        [ ]
Update Request Flow           Integration          MEDIUM      [ ]
Browser Compatibility         UI Test              MEDIUM      [ ]
Mobile Responsive             UI Test              LOW         [ ]
```

## Critical Test Paths

### 🔴 Critical (Must Test)
1. Admin portal - Cannot create location without name
2. Admin portal - Location created with valid name
3. Map app - Location name field appears
4. Map app - Form submits with/without name
5. No regression in location dropdown

### 🟡 Important (Should Test)
1. Whitespace validation works
2. Error messages display correctly
3. Placeholder text is helpful
4. Form layout not broken
5. Existing locations still work

### 🟢 Nice to Have (Good to Test)
1. Special characters in names
2. Very long names
3. Unicode characters
4. Mobile browser compatibility
5. Screen reader accessibility

## Quick Decision Tree

```
Do you have 5 minutes?
│
├─ Yes → Run automated tests: ./test-location-changes.sh
│        Run smoke tests: TESTING_CHECKLIST.md (tests 1-3)
│
└─ No  → Just verify:
         • Code compiles: pnpm typecheck
         • Tests pass: pnpm test location.test.ts
         • No console errors when opening forms
```

## Testing Resources

📋 **Full Plan**: TESTING_PLAN.md (comprehensive guide)
✅ **Quick Checklist**: TESTING_CHECKLIST.md (manual tests)
🔧 **Automation**: test-location-changes.sh (automated tests)
📊 **This Document**: TESTING_AREAS.md (visual overview)
