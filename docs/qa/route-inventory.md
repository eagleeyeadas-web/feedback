# SafDrive Application Route Inventory & Access Matrix

**Audit Date**: October 26, 2026  
**Auditor**: Senior QA Automation Engineer & Full-Stack Architect  
**Application**: Eagle Eye SafDrive Web Platform  
**Routing Architecture**: Client-side Hash Routing (`HashRouter` via `react-router-dom` v6)  
**Authentication & Authorization**: Supabase Auth with Role-Based Route Guards (`RoleProtectedRoute.jsx`, `useAuth.jsx`)  

---

## 1. Overview of Routing Architecture

The Eagle Eye SafDrive frontend uses `HashRouter` to support static and decoupled hosting environments (e.g. Render / S3 / Cloudflare Pages) without server rewrite dependencies. All paths are resolved relative to the hash fragment `#/`.

Access control is enforced at multiple layers:
1. **Route Guard Layer (`RoleProtectedRoute.jsx`)**: Checks session validity and authorized roles before mounting page components. Unauthenticated visitors are redirected to `#/login?redirect=<target_route>`.
2. **Component Layer (Workspace Subviews)**: Role-specific tabs, query parameters (`?create=true`, `?view=<id>`, `?tab=<tab_name>`), and modal triggers.
3. **API & Service Layer**: Supabase Row-Level Security (RLS) and Express middleware verifying JWT claims and role headers.

---

## 2. Complete Frontend Route Inventory

| Route Path | Type | Allowed Roles | Target Component | Purpose & Description | Test Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `#/` | Public | All (Anonymous + Authenticated) | [LandingPage.jsx](file:///c:/Users/mwahi/OneDrive/Desktop/feedback/frontend/src/pages/LandingPage.jsx) | Public entry point with platform introduction and customer portal links | **PASS** |
| `#/customer-form` | Public | All (Anonymous + Authenticated) | [FeedbackForm.jsx](file:///c:/Users/mwahi/OneDrive/Desktop/feedback/frontend/src/pages/FeedbackForm.jsx) | Public post-installation feedback & rating form for clients | **PASS** |
| `#/feedback` | Public Alias | All (Anonymous + Authenticated) | [FeedbackForm.jsx](file:///c:/Users/mwahi/OneDrive/Desktop/feedback/frontend/src/pages/FeedbackForm.jsx) | Alias pointing to customer feedback form | **PASS** |
| `#/login` | Public | Unauthenticated Staff | [Login.jsx](file:///c:/Users/mwahi/OneDrive/Desktop/feedback/frontend/src/pages/admin/Login.jsx) | Single unified staff authentication portal with role auto-detection | **PASS** |
| `#/admin/login` | Public Alias | Unauthenticated Staff | [Login.jsx](file:///c:/Users/mwahi/OneDrive/Desktop/feedback/frontend/src/pages/admin/Login.jsx) | Legacy admin login route redirecting to unified login | **PASS** |
| `#/sales` | Protected | `SALES`, `ADMIN` | [SalesWorkspacePage.jsx](file:///c:/Users/mwahi/OneDrive/Desktop/feedback/frontend/src/pages/staff/SalesWorkspacePage.jsx) | Sales team dashboard: Checklists, Quotation Generator, Quotation History | **PASS** |
| `#/sales?create=true` | Protected Subview | `SALES`, `ADMIN` | [InstallationChecklistForm.jsx](file:///c:/Users/mwahi/OneDrive/Desktop/feedback/frontend/src/pages/admin/installation/InstallationChecklistForm.jsx) | 11-section interactive installation checklist creation form | **PASS** |
| `#/sales?view=:id` | Protected Subview | `SALES`, `ADMIN` | `InstallationChecklistDetail.jsx` | Detailed sales view of customer checklist and installation tracking | **PASS** |
| `#/sales?tab=quotation-generator` | Protected Subview | `SALES`, `ADMIN` | [QuotationGenerator.jsx](file:///c:/Users/mwahi/OneDrive/Desktop/feedback/frontend/src/pages/admin/QuotationGenerator.jsx) | Live quotation generation tool with PDF generation & pricing | **PASS** |
| `#/sales?tab=quotation-history` | Protected Subview | `SALES`, `ADMIN` | `QuotationHistory.jsx` | Historical quotation archive with revision and replacement tracking | **PASS** |
| `#/technical` | Protected | `TECHNICAL`, `ADMIN` | [TechnicalWorkspacePage.jsx](file:///c:/Users/mwahi/OneDrive/Desktop/feedback/frontend/src/pages/staff/TechnicalWorkspacePage.jsx) | Service engineer workspace: Job cards, travel vouchers, completion reports | **PASS** |
| `#/technical?view=:id` | Protected Subview | `TECHNICAL`, `ADMIN` | `TechnicianJobView.jsx` | Technician job details with backup declaration & installation forms | **PASS** |
| `#/store-manager` | Protected | `STORE_MANAGER`, `ADMIN` | [StoreWorkspacePage.jsx](file:///c:/Users/mwahi/OneDrive/Desktop/feedback/frontend/src/pages/staff/StoreWorkspacePage.jsx) | Inventory issuance, dispatch verification, return verification, BOM checks | **PASS** |
| `#/store` | Protected Alias | `STORE_MANAGER`, `ADMIN` | Redirect to `#/store-manager` | Convenience alias for store manager portal | **PASS** |
| `#/coordinator` | Protected | `COORDINATOR`, `ADMIN` | [CoordinatorWorkspacePage.jsx](file:///c:/Users/mwahi/OneDrive/Desktop/feedback/frontend/src/pages/staff/CoordinatorWorkspacePage.jsx) | Logistics, flight/train tickets, accommodation, return ticket management | **PASS** |
| `#/hr` | Protected | `HR`, `ADMIN` | [HrWorkspacePage.jsx](file:///c:/Users/mwahi/OneDrive/Desktop/feedback/frontend/src/pages/staff/HrWorkspacePage.jsx) | Technician availability calendar, late completion reviews, extension approvals | **PASS** |
| `#/admin/dashboard` | Protected Dynamic | Authenticated Staff | `DashboardRedirect` in [App.jsx](file:///c:/Users/mwahi/OneDrive/Desktop/feedback/frontend/src/App.jsx#L32-L65) | Role-aware dispatcher redirecting each user to their specific department workspace | **PASS** |
| `#/admin` | Protected Dynamic | Authenticated Staff | `DashboardRedirect` in [App.jsx](file:///c:/Users/mwahi/OneDrive/Desktop/feedback/frontend/src/App.jsx#L32-L65) | Root admin alias delegating to role-aware department dispatcher | **PASS** |
| `#/admin/installation-checklists` | Protected Dynamic | Authenticated Staff | `DashboardRedirect` in [App.jsx](file:///c:/Users/mwahi/OneDrive/Desktop/feedback/frontend/src/App.jsx#L194-L197) | Legacy checklist list URL routed to authenticated department workspace | **PASS** |
| `#/admin/installation-checklists/create` | Protected Redirect | `SALES`, `ADMIN` | Redirect to `#/sales?create=true` | Legacy create checklist URL routed directly into Sales create subview | **PASS** |
| `#/admin/installation-checklists/:id` | Protected Dynamic | Authenticated Staff | `ChecklistDetailRedirect` in [App.jsx](file:///c:/Users/mwahi/OneDrive/Desktop/feedback/frontend/src/App.jsx#L71-L109) | Deep link router preserving checklist ID into corresponding user workspace | **PASS** |
| `#/admin/installation-checklists/:id/edit` | Protected Redirect | `SALES`, `ADMIN` | Redirect to `#/sales` | Legacy edit URL safely routed to sales workspace | **PASS** |
| `#/admin/quotations` | Protected Redirect | `SALES`, `ADMIN` | Redirect to `#/sales?tab=quotation-history` | Legacy quotations URL routed to Sales quotation history tab | **PASS** |
| `#/admin/quotation-generator` | Protected Redirect | `SALES`, `ADMIN` | Redirect to `#/sales?tab=quotation-generator` | Legacy quotation generator URL routed to Sales quotation generator tab | **PASS** |
| `#/quotations` | Protected Redirect | `SALES`, `ADMIN` | Redirect to `#/sales?tab=quotation-history` | Root quotations alias routed to Sales quotation history tab | **PASS** |
| `*` (Any unmapped path) | Public Fallback | All | [NotFoundPage.jsx](file:///c:/Users/mwahi/OneDrive/Desktop/feedback/frontend/src/pages/NotFoundPage.jsx) | Informative 404 page with navigation return actions | **PASS** |

---

## 3. Role-Based Access Control (RBAC) Matrix

The table below details cross-role access enforcement verified during automated headless browser testing:

| Role / Persona | Landing (`#/`) | Login (`#/login`) | Sales (`#/sales`) | Technical (`#/technical`) | Store (`#/store-manager`) | Coordinator (`#/coordinator`) | HR (`#/hr`) | Admin Redirect (`#/admin`) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Unauthenticated / Anonymous** | **ALLOW** | **ALLOW** | **REDIRECT** (`/login`) | **REDIRECT** (`/login`) | **REDIRECT** (`/login`) | **REDIRECT** (`/login`) | **REDIRECT** (`/login`) | **REDIRECT** (`/login`) |
| **SALES** (`sales@gmail.com`) | **ALLOW** | **ALLOW** | **ALLOW** | **DENIED** (Access Denied) | **DENIED** (Access Denied) | **DENIED** (Access Denied) | **DENIED** (Access Denied) | **REDIRECT** (`/sales`) |
| **TECHNICAL** (`tech@gmail.com`) | **ALLOW** | **ALLOW** | **DENIED** (Access Denied) | **ALLOW** | **DENIED** (Access Denied) | **DENIED** (Access Denied) | **DENIED** (Access Denied) | **REDIRECT** (`/technical`) |
| **STORE_MANAGER** (`store@gmail.com`)| **ALLOW** | **ALLOW** | **DENIED** (Access Denied) | **DENIED** (Access Denied) | **ALLOW** | **DENIED** (Access Denied) | **DENIED** (Access Denied) | **REDIRECT** (`/store-manager`)|
| **COORDINATOR** (`coordinator@gmail.com`)| **ALLOW** | **ALLOW** | **DENIED** (Access Denied) | **DENIED** (Access Denied) | **DENIED** (Access Denied) | **ALLOW** | **DENIED** (Access Denied) | **REDIRECT** (`/coordinator`)|
| **HR** (`hr@gmail.com`) | **ALLOW** | **ALLOW** | **DENIED** (Access Denied) | **DENIED** (Access Denied) | **DENIED** (Access Denied) | **DENIED** (Access Denied) | **ALLOW** | **REDIRECT** (`/hr`) |
| **ADMIN** (`admin@gmail.com`) | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | **REDIRECT** (`/sales`) |

---

## 4. Subview & Modal Navigation Inventory

### 4.1 Sales Workspace (`#/sales`)
- **Main View**: Installation Checklist Table with stage filters (`All`, `Pending Store Issuance`, `In Transit / Dispatched`, `Installation In Progress`, `Completed`, `Customer Couriered`).
- **Create Subview (`?create=true`)**: Full 11-section form (`Client Details`, `Scope of Work`, `Checklist Type`, `Engineer Assignment`, `Schedule`, `Vehicle & Camera Config`, `Cable Matrix`, `Accessories`, `Additional Requirements`, `Coordinator Flight/Train Booking Requirements`, `Confirmation`).
- **Checklist Details (`?view=:id`)**: Comprehensive view of customer checklist, status progression, attached photos, and timeline.
- **Quotation Generator Tab (`?tab=quotation-generator`)**: Live quotation builder, GST calculation, automatic discount/markup, and PDF download.
- **Quotation History Tab (`?tab=quotation-history`)**: List of saved quotations with 20-day deletion safeguards and version replacement.

### 4.2 Technical Workspace (`#/technical`)
- **Main View**: Assigned Job Cards with status indicators (`Assigned`, `Carried`, `On Site`, `Completed`).
- **Modals & Drawers**:
  - `TechnicianBackupDeclarationModal`: Technician backup stock verification with dynamic BOM check and validation guards.
  - `ExtraDeviceInstallationModal`: Field reporting of extra camera/sensor/GPS hardware installed on-site.
  - `ScheduleExtensionRequestModal`: Form requesting additional hours/days with mandatory justification.
  - `InstallationCompletionReportModal`: Mandatory final checklist submission with camera angles, photos, and customer signature.

### 4.3 Store Manager Workspace (`#/store-manager`)
- **Main View**: Pending Issuance queue, Stock Balance, and Dispatched records.
- **Modals & Drawers**:
  - `StockIssuanceModal`: Scans/verifies serial numbers, cables, cameras, and brackets against checklist BOM.
  - `LooseStockIssuanceModal`: Allocates extra backup equipment carried by technicians.
  - `CourierDispatchModal`: Enters docket number, courier partner (BlueDart, DTDC, Delhivery), and tracking URL.
  - `ReturnVerificationModal`: Confirms return of unused/defective devices and checks items back into active inventory.

### 4.4 Coordinator Workspace (`#/coordinator`)
- **Main View**: Active travel jobs, accommodation assignments, courier tracking, and return tickets.
- **Modals & Drawers**:
  - `OutboundTravelModal`: Records flight/train PNR, travel date, ticket attachments, and departure time.
  - `HotelAccommodationModal`: Records hotel name, room allocation, check-in/out dates, and booking vouchers.
  - `ReturnTravelModal`: Confirms return journey tickets and updates `return_task_completed` flag.
  - `CourierUpdateModal`: Live tracking sync and delivery confirmation.

### 4.5 HR Workspace (`#/hr`)
- **Main View**: Master Technician Availability Calendar, Schedule Extension Requests queue, Late Completion Declarations.
- **Modals & Drawers**:
  - `ExtensionApprovalModal`: Approves or rejects technician extension requests with real-time calendar re-allocation.
  - `LateCompletionInvestigationModal`: Reviews engineer delay logs, technician explanations, and approves payroll/overtime credits.
