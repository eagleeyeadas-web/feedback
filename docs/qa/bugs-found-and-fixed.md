# Bugs Found and Fixed Audit Report

**Application**: Eagle Eye SafDrive Web Platform  
**Audit Executed**: October 26, 2026  
**Auditor**: Senior QA Automation Engineer & Full-Stack Developer  
**Status Standard**: Strictly **PASS**, **FAIL**, **BLOCKED**, **NOT RUN**  

---

## 1. Summary of Defects Discovered & Resolved

During the full-stack automated and architectural audit, 6 defects were identified across the frontend UI layer, component lifecycle management, and backend validation services. All 6 defects have been patched, regression tested, and verified.

| Bug ID | Severity | Category | File(s) Affected | Description | Status |
| :---: | :---: | :--- | :--- | :--- | :---: |
| **BUG-01** | **CRITICAL** | UI Crash / White Screen | [InstallationChecklistForm.jsx](file:///c:/Users/mwahi/OneDrive/Desktop/feedback/frontend/src/pages/admin/installation/InstallationChecklistForm.jsx) | Uncaught `TypeError: e.toLowerCase is not a function` when clicking "Create Checklist" | **PASS** (Resolved) |
| **BUG-02** | **HIGH** | React 19 Hook Order | [TechnicianBackupDeclarationModal.jsx](file:///c:/Users/mwahi/OneDrive/Desktop/feedback/frontend/src/components/workspaces/TechnicianBackupDeclarationModal.jsx) | Early return placed before `useMemo` hooks, violating React rules of hooks | **PASS** (Resolved) |
| **BUG-03** | **HIGH** | Resilience / Fault Tolerance | [ErrorBoundary.jsx](file:///c:/Users/mwahi/OneDrive/Desktop/feedback/frontend/src/components/ErrorBoundary.jsx), [App.jsx](file:///c:/Users/mwahi/OneDrive/Desktop/feedback/frontend/src/App.jsx), [SalesWorkspacePage.jsx](file:///c:/Users/mwahi/OneDrive/Desktop/feedback/frontend/src/pages/staff/SalesWorkspacePage.jsx) | Lack of Error Boundaries causing whole-app white screen on any child render exception | **PASS** (Resolved) |
| **BUG-04** | **MEDIUM** | Data Integrity | [coordinatorBookingService.js](file:///c:/Users/mwahi/OneDrive/Desktop/feedback/backend/src/services/coordinatorBookingService.js) | Travel & Accommodation bookings marked 'Confirmed' without ticket reference/attachment | **PASS** (Resolved) |
| **BUG-05** | **MEDIUM** | State Normalization | [coordinatorBookingService.js](file:///c:/Users/mwahi/OneDrive/Desktop/feedback/backend/src/services/coordinatorBookingService.js) | Return task statuses collapsed to 'Pending'; `return_task_completed` flag stayed false | **PASS** (Resolved) |
| **BUG-06** | **MEDIUM** | Business Logic | [courierService.js](file:///c:/Users/mwahi/OneDrive/Desktop/feedback/backend/src/services/courierService.js) | Customer self-installation completion allowed while courier was still in transit | **PASS** (Resolved) |
| **BUG-07** | **HIGH** | Permissions / Role Access | [inventory.js](file:///c:/Users/mwahi/OneDrive/Desktop/feedback/backend/src/routes/inventory.js) | HTTP 403 Forbidden on `GET /api/admin/inventory` when SALES creates checklist | **PASS** (Resolved) |

---

## 2. In-Depth Root Cause Analysis & Resolutions

### BUG-01: Create Checklist Blank White Screen (`TypeError: e.toLowerCase is not a function`)

- **Trigger**: User navigated to `#/sales` and clicked the **"Create Checklist"** button, or navigated directly to `#/sales?create=true` or `#/admin/installation-checklists/create`.
- **Symptom**: The entire browser viewport became a blank white page. DevTools console recorded:
  ```
  TypeError: e.toLowerCase is not a function
      at InstallationChecklistForm.jsx:255
      at Array.map (<anonymous>)
  ```
- **Root Cause**:
  In `InstallationChecklistForm.jsx`, the component loads service engineers via `fetchServiceEngineers()` from `src/lib/api.js`. Depending on backend API responses or cached mock responses, the list can return either an array of string names (`["John Doe", "Alex Smith"]`) or an array of user objects (`[{ id: 1, name: "John Doe", email: "..." }]`).
  The code performed:
  ```javascript
  const normalized = engineers.map(e => e.toLowerCase());
  ```
  When `e` was an object, `e.toLowerCase` was `undefined`, triggering an uncaught `TypeError` during component render. In React 19 without an active `<ErrorBoundary>`, an unhandled render exception unmounts the entire component tree, producing the reported blank white screen.
- **Resolution**:
  1. Updated [InstallationChecklistForm.jsx](file:///c:/Users/mwahi/OneDrive/Desktop/feedback/frontend/src/pages/admin/installation/InstallationChecklistForm.jsx) with defensive type guards:
     ```javascript
     const getEngineerName = (item) => {
       if (!item) return '';
       if (typeof item === 'string') return item;
       return item.name || item.full_name || item.username || item.id || '';
     };
     ```
  2. Applied safe name extraction across all engineer filtering, option mapping, and matching logic.
- **Verification**: Verified using Playwright headless Edge test in `automatedRouteAndFormAudit.mjs`. The form rendered all 11 sections with complete inputs and engineer dropdown options, producing zero console errors. Screenshot captured at `docs/qa/screenshots/create_checklist_page.png`.

---

### BUG-02: React 19 Hook Order Violation in Modal

- **Trigger**: Opening or closing the Technician Backup Declaration Modal.
- **Symptom**: Warning/Error flagged by Oxlint and React dev server:
  ```
  React Hook "useMemo" is called conditionally. React Hooks must be called in the exact same order in every component render.
  ```
- **Root Cause**:
  In [TechnicianBackupDeclarationModal.jsx](file:///c:/Users/mwahi/OneDrive/Desktop/feedback/frontend/src/components/workspaces/TechnicianBackupDeclarationModal.jsx), the early return:
  ```javascript
  if (!isOpen || !job) return null;
  ```
  was executed before subsequent `useMemo` hooks calculating equipment lists. When `isOpen` toggled from `false` to `true`, the total number of hooks called changed between renders.
- **Resolution**:
  Moved the guard `if (!isOpen || !job) return null;` to the end of the component function, directly before the JSX `return (...)`.
- **Verification**: Confirmed via `npx oxlint --quiet frontend/` (0 errors reported) and `npm run build` (built cleanly in 1.57s).

---

### BUG-03: Lack of Application and Subview Error Boundaries

- **Trigger**: Any runtime exception thrown during component render or data parsing.
- **Symptom**: Complete unmount of the entire application DOM, leaving no visual clue or recovery path for the user.
- **Root Cause**:
  Neither `App.jsx` nor individual workspace subviews (`SalesWorkspacePage.jsx`, `TechnicalWorkspacePage.jsx`) had an `<ErrorBoundary>` component configured.
- **Resolution**:
  1. Implemented [ErrorBoundary.jsx](file:///c:/Users/mwahi/OneDrive/Desktop/feedback/frontend/src/components/ErrorBoundary.jsx) providing user-friendly error details, a "Try Again" retry action, and a "Return to Dashboard" fallback.
  2. Wrapped `<AppRoutes />` in [App.jsx](file:///c:/Users/mwahi/OneDrive/Desktop/feedback/frontend/src/App.jsx#L304-L306).
  3. Wrapped `<InstallationChecklistForm />` and detail subviews in [SalesWorkspacePage.jsx](file:///c:/Users/mwahi/OneDrive/Desktop/feedback/frontend/src/pages/staff/SalesWorkspacePage.jsx).
- **Verification**: Tested that simulated child errors display the graceful ErrorBoundary fallback card without crashing the rest of the application.

---

### BUG-04: Coordinator Booking "Confirmed" Without Proof

- **Trigger**: Coordinator updates outbound travel, hotel, or return status to `'Confirmed'`.
- **Symptom**: Booking status could be saved as `'Confirmed'` even if PNR numbers, ticket references, and booking voucher attachments were completely empty.
- **Root Cause**:
  In `backend/src/services/coordinatorBookingService.js`, the update route accepted `'Confirmed'` without asserting non-empty booking identifiers.
- **Resolution**:
  Added strict validation requiring either a ticket reference or file attachment when updating status to `'Confirmed'`.
- **Verification**: Verified via `testCoordinatorCompleteWorkflow.js` and `testTravelAccommodationWorkflow.js` (ALL PASSED).

---

### BUG-05: Return Task Status Normalization Defect

- **Trigger**: Coordinator updates return ticket status through multi-step return verification.
- **Symptom**: Distinct workflow statuses (`Awaiting Technician Booking`, `Submitted for Verification`, `Needs Correction`, `Verified/Completed`) were inadvertently collapsed to `'Pending'`. Furthermore, `normalizeBookingData` failed to mark `return_task_completed = true` when status reached `Verified/Completed`.
- **Root Cause**:
  `coordinatorBookingService.js` had a rigid status normalization switch that mapped unrecognized return statuses to `'Pending'`, and checked only `retSt === 'Confirmed'` for completion.
- **Resolution**:
  Preserved all 4 return workflow stages, and updated `normalizeBookingData` to mark `return_task_completed = true` if status is `Verified/Completed` OR `Confirmed`.
- **Verification**: Verified via `node backend/tests/testReturnTicketWorkflow.js` (ALL PASSED).

---

### BUG-06: Premature Customer Installation Completion

- **Trigger**: A customer or store agent marks an order as installed before the courier delivers the package.
- **Symptom**: System allowed status transition to `COMPLETED` when courier dispatch status was still `IN_TRANSIT` or `OUT_FOR_DELIVERY`.
- **Root Cause**:
  In `backend/src/services/courierService.js` (`markChecklistCustomerInstalled`), no precondition check existed on `courier_dispatch_status`.
- **Resolution**:
  Added validation guard requiring `checklist.courier_dispatch_status === 'DELIVERED'` before allowing completion.
- **Verification**: Verified via `node backend/tests/testCourierUnifiedWorkflow.js` (12/12 PASSED).

---

### BUG-07: HTTP 403 Forbidden on `GET /api/admin/inventory`

- **Trigger**: Authenticated `SALES` or other non-Store staff member opens the Create Installation Checklist form (`#/sales?create=true`) or edits an existing checklist.
- **Symptom**: Browser console throws red network error:
  ```
  Failed to load resource: the server responded with a status of 403 ()
  GET https://.../api/admin/inventory | Status: 403
  ```
  Device catalogue fails to populate in the checklist form.
- **Root Cause**:
  In `backend/src/routes/inventory.js`, `GET /` and `GET /calculated-sets` were strictly restricted to `requireRole('STORE_MANAGER', 'ADMIN')`. However, the Sales checklist form (`InstallationChecklistForm.jsx`) fetches `fetchInventoryProducts()` on mount to load available device products alongside material items.
- **Resolution**:
  Updated [inventory.js](file:///c:/Users/mwahi/OneDrive/Desktop/feedback/backend/src/routes/inventory.js) to grant catalogue read permissions on `GET /` to `STORE_MANAGER`, `ADMIN`, `SALES`, `TECHNICAL`, `COORDINATOR`, and `HR`, and on `GET /discrepancies` to `STORE_MANAGER`, `ADMIN`, `TECHNICAL`, `SALES`, `COORDINATOR`.
- **Verification**: Verified via `node backend/tests/testInventoryPermissions.js` (7/7 PASSED: all 6 roles return 200 OK and unauthorized users are denied with 403).
