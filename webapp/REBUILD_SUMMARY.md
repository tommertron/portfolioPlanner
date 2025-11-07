# Web App Rebuild Summary

## What Changed

The web app has been **completely rebuilt** from scratch to work with the new simplified portfolio scheduler model.

## What Was Removed

❌ **Individual People Management** - No more person-by-person tracking
❌ **Skills System** - Skills and skillsets removed
❌ **Complex Settings** - Solver modes, allocation curves, effort profiles
❌ **Resource Allocation Heatmap** - No manual allocation editing
❌ **Old Capacity Tracker Integration** - Replaced with new scheduler

## What's Now Included

✅ **Portfolio Selection** - Simple dropdown to choose portfolio
✅ **Projects Management** - Editable table for projects with effort estimates
✅ **Resource Types Configuration** - Simple form for BA, Developer, PM counts
✅ **Basic Settings** - Just planning start date
✅ **Run Model** - Big button to execute the scheduler
✅ **Timeline Results** - Table showing scheduled projects with dates
✅ **Bottleneck Analysis** - Rendered markdown with utilization metrics
✅ **File Downloads** - Export results as CSV and MD

## New Interface

### 1. Portfolio Selection
- Dropdown at the top to select portfolio
- Loads all portfolio data automatically
- Green "Run Model" button always visible

### 2. Projects Tab
- Editable inline table
- Columns: ID, Name, Program, Priority, BA (pm), PM (pm), Dev (pm)
- Add/Delete projects
- Auto-save button appears on changes

### 3. Resources Tab
Two sections:
- **Time Off Settings**: Holidays per year, Average time off
- **Resource Types**: Cards for each resource type (BA, Developer, PM)
  - Number of people
  - KTLO percentage
  - WIP limit
  - Average time off (optional override)

### 4. Settings Tab
- Planning start date picker
- Recent jobs list with status

### 5. Results Tab
Shows after running model:
- **Project Timeline**: Table with start/end dates and duration
- **Bottleneck Analysis**: Full markdown report rendered
- Export buttons for CSV and MD files

### 6. Files Tab
- Browse input and output files
- Click to download
- Shows last modified timestamps

## Technology Stack

- **Bootstrap 5** - Modern, responsive UI
- **Bootstrap Icons** - Clean iconography
- **Marked.js** - Markdown rendering
- **Vanilla JavaScript** - No framework dependencies
- **Flask Backend** - Existing API endpoints

## Key Features

### Live Editing
- Projects table cells are contenteditable
- Changes tracked automatically
- Save button appears when modifications detected

### Job Status Polling
- Automatically polls job status every 2 seconds
- Shows progress in UI
- Auto-loads results when complete
- Re-enables Run button when done

### Clean Data Flow
1. Select portfolio
2. Edit projects/resources/settings
3. Click Run Model
4. Wait for completion
5. View results automatically

## File Structure

```
webapp/
├── templates/
│   ├── index.html        # NEW: Simplified interface
│   └── index_old.html    # OLD: Preserved for reference
├── static/
│   └── app.js            # OLD: No longer used
├── app.py                # UPDATED: Works with new scheduler
└── jobs.py               # UNCHANGED: Job management
```

## API Usage

The new interface uses these endpoints:

**Data Management:**
- `GET /api/projects/<portfolio>` - Load projects
- `POST /api/projects/<portfolio>` - Save projects
- `GET /api/resources/<portfolio>` - Load resources
- `POST /api/resources/<portfolio>` - Save resources
- `GET /api/config/<portfolio>` - Load config
- `POST /api/config/<portfolio>` - Save config

**Execution:**
- `POST /run` - Execute scheduler
- `GET /status/<job_id>` - Poll job status

**Results:**
- `GET /api/output/projects/<portfolio>` - Scheduled projects
- `GET /api/output/bottleneck/<portfolio>` - Bottleneck analysis

**Files:**
- `GET /api/files/<portfolio>` - File listing
- `GET /files/<portfolio>/<path>` - Download file

## Usage Workflow

1. **Start the app**: `./start.sh`
2. **Select portfolio**: Choose from dropdown (e.g., "ea-roadmap")
3. **Review/Edit Projects**: Switch to Projects tab, make changes
4. **Configure Resources**: Set people counts, KTLO, WIP limits
5. **Set Start Date**: Planning start date in Settings
6. **Run Model**: Click the big green button
7. **View Results**: Results tab auto-loads when complete
8. **Export**: Download CSV or MD files

## Advantages of New Design

✨ **Simpler** - Only what you need, nothing more
✨ **Faster** - Lightweight, no complex dependencies
✨ **Clearer** - Obvious workflow from input → run → results
✨ **Self-Contained** - All JS inline, no external files needed
✨ **Modern** - Bootstrap 5, clean design

## Testing

To test the new interface:

```bash
# Start the server
./start.sh

# In browser, go to http://localhost:5959
# 1. Select "ea-roadmap" from dropdown
# 2. Verify Projects tab shows projects
# 3. Check Resources tab shows BA, Developer, PM
# 4. Go to Settings, verify start date
# 5. Click "Run Model"
# 6. Wait for completion
# 7. Go to Results tab
# 8. Verify Timeline and Bottleneck display
```

## Migration Notes

If you need the old interface:
- Rename `webapp/templates/index_old.html` to `index.html`
- Restart the server

The old interface is preserved for reference but won't work correctly with the new scheduler without updates to app.js.

## Next Steps

Possible enhancements:
- Visual Gantt chart for timeline
- Resource utilization charts
- Program color coding in timeline
- Search/filter in projects table
- Undo/redo for edits
- Dark mode toggle

But the current version has everything needed for core functionality!
