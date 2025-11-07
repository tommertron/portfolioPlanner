# Frontend Updates Needed for app.js

The Flask backend has been updated to work with the new portfolio scheduler. The frontend JavaScript (`webapp/static/app.js`) needs updates to match the new API and data structures.

## Key Changes Required

### 1. Resource Management (People → Resources)
**Old**: Individual people with roles
**New**: Resource types with counts

#### Update API calls:
- Change `/api/people/<portfolio>` to `/api/resources/<portfolio>`
- Update data structure from array of people to:
  ```json
  {
    "time_off": { "holidays_per_year": 15, "avg_time_off_all_resources": 20 },
    "resources": [
      { "type": "BA", "number": 2, "ktlo_percentage": 0.2, "wip_limit": 2 }
    ]
  }
  ```

#### UI Changes:
- Remove person-by-person management
- Add resource type configuration UI
- Fields: type, number, ktlo_percentage, wip_limit, avg_time_off

### 2. Results Display

#### Timeline Tab:
- Fetch from: `/api/output/projects/<portfolio>`
- Data structure: CSV with id, name, priority, efforts, **start_date, end_date**
- Create Gantt-style timeline visualization
- Color-code by program
- Allow sorting by start date or program

#### Bottleneck Analysis Tab:
- Fetch from: `/api/output/bottleneck/<portfolio>`
- Returns: `{ "markdown": "..." }`
- Render markdown using marked.js (already imported)
- Display resource utilization tables
- Highlight bottlenecks (>80% utilization)

### 3. Projects Table
**No changes needed** - projects.csv format is compatible

### 4. Settings Tab
Update to show:
- Planning start date
- Resource configuration (moved from People tab)
- Big "Run Model" button

### 5. Remove/Simplify
These features from the old app aren't needed:
- Resource allocation heatmap editing (we don't edit allocations)
- Skills management (not in new model)
- Individual person cards
- Program preferences per person

## Suggested Simplified Approach

Since the frontend is complex, consider starting with a **minimal viable UI**:

### Phase 1: Core Functionality
1. **Portfolio selector** (already works)
2. **Projects tab**: Editable table with save/discard
3. **Resources tab**: Simple form for each resource type
4. **Run button**: Triggers model execution
5. **Status display**: Shows job progress

### Phase 2: Results Visualization
1. **Timeline view**: Simple table showing scheduled dates
2. **Bottleneck view**: Display markdown analysis
3. **Export buttons**: Download CSV and MD files

### Phase 3: Enhanced UX
1. **Visual timeline**: Gantt chart using Chart.js
2. **Interactive filters**: By program, date range
3. **Real-time updates**: Auto-refresh after job completes

## Quick Wins

To get the app working quickly:

1. **Update loadResources()** function to handle new format
2. **Create renderResourcesEditor()** function for resource types
3. **Update displayResults()** to fetch and show:
   - Output projects with dates
   - Bottleneck markdown
4. **Test with existing portfoliotester** portfolio

## Example Code Snippets

### Fetch and Display Bottleneck Analysis
```javascript
async function loadBottleneckAnalysis(portfolioName) {
    const response = await fetch(`/api/output/bottleneck/${portfolioName}`);
    const data = await response.json();
    if (data.markdown) {
        document.getElementById('bottleneck-container').innerHTML =
            marked.parse(data.markdown);
    }
}
```

### Fetch and Display Scheduled Projects
```javascript
async function loadScheduledProjects(portfolioName) {
    const response = await fetch(`/api/output/projects/${portfolioName}`);
    const projects = await response.json();
    // Create timeline visualization
    renderTimeline(projects);
}
```

### Render Resources Editor
```javascript
function renderResourcesEditor(resourcesData) {
    const container = document.getElementById('resources-container');
    container.innerHTML = '';

    resourcesData.resources.forEach(resource => {
        const div = document.createElement('div');
        div.className = 'resource-editor';
        div.innerHTML = `
            <h4>${resource.type}</h4>
            <label>Number: <input type="number" value="${resource.number}"></label>
            <label>KTLO %: <input type="number" value="${resource.ktlo_percentage * 100}"></label>
            <label>WIP Limit: <input type="number" value="${resource.wip_limit}"></label>
        `;
        container.appendChild(div);
    });
}
```

## Testing Strategy

1. **Start the webapp**: `python run_webapp.py`
2. **Test portfolio selection**: Should list portfoliotester and ea-roadmap
3. **Test project loading**: Should display projects.csv
4. **Test run button**: Should execute scheduler
5. **Test results display**: Should show timeline and bottleneck analysis

## Current Status

✅ **Backend Complete**: All API endpoints updated and working
⚠️ **Frontend Pending**: Needs updates to app.js
📝 **Recommendation**: Start with minimal UI, then enhance incrementally

The app will likely work for basic operations (portfolio selection, file viewing) but the editing and results visualization will need the above updates to function properly with the new data model.
