# Model Catalog Wizard Modal - Current State

## Overview

The Model Catalog Wizard Modal is a multi-step deployment wizard that allows users to map blueprint components to database tables and deploy dimensional models. The wizard consists of two main steps: **Mapping** and **Deployment**.

## Architecture

### Components Structure

```
model-catalog/_modal/
├── wizard-modal.tsx          # Main modal container
└── _parts/
    ├── blueprints-sidebar.tsx    # Left sidebar with blueprint list
    ├── source-selectors.tsx      # Database/schema/table selectors
    ├── field-bindings.tsx        # Field mapping table
    ├── deployment-summary.tsx    # Deployment summary table
    └── deployment-logs.tsx       # Deployment logs display
```

### State Management

The wizard uses Zustand for state management via `useModelCatalogWizard()` hook located in `lib/state/model-catalog-wizard.ts`.

**Key State Properties:**
- `isOpen`: Boolean - Modal visibility
- `step`: 'mapping' | 'deployment' - Current wizard step
- `selectedModelIds`: string[] - Selected model IDs for deployment
- `blueprintCatalog`: Array<any> - List of blueprints for selected models
- `selectedBlueprintKey`: string - Currently selected blueprint (format: `source.name`)
- `blueprintDatabaseBindings`: Record<BlueprintKey, DatabaseBinding> - Database bindings per blueprint
- `bindingMappings`: Record<string, string> - Field-to-column mappings
- `blueprintStatuses`: Record<BlueprintKey, WizardStatusColor> - Status indicators (red/orange/green/grey)
- `logLines`: string[] - Deployment log messages
- `isDeploying`: boolean - Deployment in progress flag

## Step 1: Mapping

### Blueprints Sidebar

**File:** `_parts/blueprints-sidebar.tsx`

- Displays list of blueprint components for selected models
- Shows status indicator (colored dot) next to each blueprint:
  - **Green**: All fields mapped correctly
  - **Orange**: All fields mapped but some have type mismatches
  - **Red**: Some fields missing bindings
  - **Grey**: Not configured
- Automatically loads blueprints when modal opens
- Auto-selects first blueprint if none selected

### Source Selectors

**File:** `_parts/source-selectors.tsx`

- Three-level selector: Database → Schema → Table
- Cascading dropdowns (schema depends on database, table depends on schema)
- Stores selections in `blueprintDatabaseBindings` per blueprint
- Persists selections when switching between blueprints

### Field Bindings

**File:** `_parts/field-bindings.tsx`

**Key Features:**

1. **Field Display Table**
   - Shows all blueprint fields (table_pk, primary_node, secondary_nodes, columns)
   - Status column with visual indicators:
     - ⏰ Clock icon (amber): Pending - no column selected
     - ❌ X icon (red): Type mismatch - data will be converted
     - ✅ Check icon (green): Bound correctly
   - Source Table Column dropdown with smart filtering:
     - Hides already-used columns
     - Shows current selection
     - Allows matching by field name (e.g., TASK_ID for task_id)

2. **Auto-save Functionality**
   - Automatically saves bindings 500ms after changes
   - Saves when database/schema/table changes
   - Shows "Saving..." indicator during save

3. **Default Binding Restoration**
   - When blueprint is selected, attempts to restore saved bindings
   - Validates database/schema/table exist before setting
   - Uses refs to prevent infinite loops:
     - `isProcessingBindingRef`: Prevents concurrent processing
     - `processedBindingKeyRef`: Tracks already-processed bindings

4. **Status Calculation**
   - Automatically calculates blueprint status based on field bindings
   - Updates `blueprintStatuses` in wizard store
   - Status logic:
     - **Red**: No table selected OR any field missing binding
     - **Orange**: All fields bound but some have type mismatches
     - **Green**: All fields bound correctly with no type mismatches

5. **Type Validation**
   - Normalizes data types for comparison (string, number, datetime, boolean)
   - Warns users about type mismatches with tooltips
   - Allows continuation (data will be converted during deployment)

**Prevented Issues:**
- Infinite loop prevention: Uses refs and stable function references
- Dependency optimization: Only depends on necessary values, not entire wizard object

## Step 2: Deployment

### Deployment Summary

**File:** `_parts/deployment-summary.tsx`

- Displays table showing:
  - Database FQN (database.schema.table) or "Not configured"
  - Arrow separator (➜)
  - Blueprint name (formatted)
- Shows all blueprints that will be deployed
- Updates based on current database bindings

### Deployment Logs

**File:** `_parts/deployment-logs.tsx`

- Shows deployment progress with status badge:
  - "Ready to deploy" (secondary badge)
  - "Deploying..." (default badge)
- Scrollable log area with auto-scroll to bottom
- Displays log messages in monospace font
- Empty state message when no logs

### Deployment Handler

**File:** `wizard-modal.tsx`

**Deployment Process:**

1. **Blueprint Tables** (deployed first)
   - Iterates through all blueprints in catalog
   - Calls `deployBlueprintTable(blueprintKey, { replace_objects: true })`
   - Logs success/failure for each

2. **Dimensional Models** (deployed second)
   - Fetches dimensions and facts to determine model types
   - For each selected model:
     - If dimension: calls `deployDimension(modelId, { replace_objects: true })`
     - If fact: calls `deployFact(modelId, { replace_objects: true })`
   - Logs success/failure for each

3. **Completion**
   - Shows success toast notification
   - Closes modal after 2 seconds
   - Resets wizard state

**Error Handling:**
- Individual blueprint/model failures don't stop deployment
- Errors are logged with details
- Shows error toast on critical failures

## Button States

### Step 1 (Mapping)
- **Cancel**: Always enabled - Closes modal and resets state
- **Next**: 
  - Disabled if any blueprint is missing database bindings (db, schema, or table)
  - Enabled when all blueprints have complete database bindings

### Step 2 (Deployment)
- **Cancel**: Always enabled - Closes modal and resets state
- **Back**: Always enabled - Returns to mapping step
- **Deploy**: 
  - Disabled while `isDeploying === true`
  - Shows "Deploying..." text when active
  - Enabled when ready to deploy

## API Integration

### Endpoints Used

1. **Blueprint Discovery**
   - `POST /api/model-catalog/wizard/blueprints` - Get blueprints for selected models

2. **Binding Management**
   - `GET /api/model-catalog/wizard/bindings?source=X&name=Y` - Get blueprint bindings
   - `PUT /api/model-catalog/wizard/bindings` - Update blueprint bindings

3. **Source Discovery**
   - `GET /api/model-catalog/sources/databases` - List databases
   - `GET /api/model-catalog/sources/schemas?database=X` - List schemas
   - `GET /api/model-catalog/sources/tables?database=X&schema=Y` - List tables
   - `GET /api/model-catalog/sources/columns?database=X&schema=Y&table=Z` - List columns
   - `GET /api/model-catalog/sources/db-schemas` - Get databases with schemas (cached)

4. **Deployment**
   - `POST /api/model-catalog/wizard/deploy/blueprint-table` - Deploy blueprint table
   - `POST /api/model-catalog/wizard/deploy/dimension` - Deploy dimension
   - `POST /api/model-catalog/wizard/deploy/fact` - Deploy fact

## Data Flow

### Blueprint Selection Flow

1. User selects models in main catalog page
2. Clicks "Deploy" button
3. Modal opens, loads blueprints for selected models
4. First blueprint auto-selected
5. Blueprint bindings loaded from API
6. If saved bindings exist, database/schema/table restored
7. Table columns loaded when table selected
8. Field bindings displayed and editable

### Status Update Flow

1. User maps fields to columns
2. `handleBindingChange` updates `bindingMappings`
3. `fields` array recalculated (useMemo)
4. Status calculation effect runs
5. `setBlueprintStatus` updates wizard store
6. Sidebar re-renders with new status indicator

### Deployment Flow

1. User completes all mappings (all indicators green)
2. Clicks "Next" to go to deployment step
3. Summary shows all blueprint mappings
4. User clicks "Deploy"
5. Deployment handler:
   - Sets `isDeploying = true`
   - Deploys blueprint tables sequentially
   - Deploys dimensions/facts sequentially
   - Logs progress to `logLines`
   - Sets `isDeploying = false` on completion
6. Modal closes after 2 seconds

## Key Optimizations

1. **Infinite Loop Prevention**
   - Uses refs to track processing state
   - Stable function references from Zustand store
   - Dependency arrays carefully managed

2. **Performance**
   - Database/schema list cached in memory
   - React Query for data fetching with caching
   - Debounced auto-save (500ms)

3. **User Experience**
   - Auto-scroll logs to bottom
   - Visual status indicators
   - Clear error messages
   - Loading states

## Known Limitations

1. **Type Mismatches**: Currently only warns, doesn't prevent deployment
2. **Partial Deployment**: If one blueprint fails, others continue (by design)
3. **No Undo**: Once deployed, changes require manual rollback
4. **No Progress Bar**: Only text-based logs (could add progress bar)

## Future Enhancements

- Add progress bar for deployment
- Add validation before allowing deployment
- Add ability to preview SQL before deployment
- Add deployment history/audit log
- Add ability to cancel in-progress deployment
- Add batch operations (select multiple blueprints)

