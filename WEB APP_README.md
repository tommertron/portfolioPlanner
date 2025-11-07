# Portfolio Planner Web App

A web-based interface for managing project portfolios, scheduling resources, and visualizing bottlenecks.

## Quick Start

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Run the Web App

```bash
python run_webapp.py
```

The app will start on http://localhost:5000

## Features

### Portfolio Management
- **Select Portfolio**: Choose from existing portfolios using the dropdown
- **Create Portfolio**: Click "+ New Portfolio" to create a new portfolio with sample data
- **Switch Between Portfolios**: Easy switching to work on different portfolios

### Projects Tab
- **View Projects**: See all projects with effort estimates and priorities
- **Edit Projects**: Click on cells to edit project details
- **Add/Delete Projects**: Manage your project list
- **Organize by Programs**: Group projects into programs with color coding

### Resources Tab
- **Configure Resources**: Define resource types (BA, Developer, PM)
- **Set Capacity**: Specify number of people per resource type
- **KTLO Allocation**: Set percentage of time for "Keep The Lights On" work
- **Time Off**: Configure holidays and average time off per resource
- **WIP Limits**: Set maximum concurrent projects per resource type

### Settings Tab
- **Planning Start Date**: Set when your planning period begins
- **Run Model**: Execute the portfolio scheduler to generate timelines

### Results Tab
After running the model, view:
- **Project Timeline**: Visual timeline showing when projects are scheduled
- **Bottleneck Analysis**: Detailed markdown report showing:
  - Resource utilization percentages
  - Months at capacity
  - Bottleneck identification
  - Hiring recommendations

### Files Tab
- **Download Files**: Export input and output files
- **View File Info**: See modification dates and file sizes

## API Endpoints

The web app provides REST API endpoints:

### Portfolio Operations
- `GET /dirs` - List available portfolios
- `POST /api/portfolio/create` - Create new portfolio

### Project Management
- `GET /api/projects/<portfolio_name>` - Get projects
- `POST /api/projects/<portfolio_name>` - Save projects

### Resource Management
- `GET /api/resources/<portfolio_name>` - Get resources configuration
- `POST /api/resources/<portfolio_name>` - Save resources configuration

### Configuration
- `GET /api/config/<portfolio_name>` - Get config
- `POST /api/config/<portfolio_name>` - Save config

### Model Execution
- `POST /run` - Run the portfolio scheduler
- `GET /status/<job_id>` - Check job status

### Results
- `GET /api/output/projects/<portfolio_name>` - Get scheduled projects
- `GET /api/output/bottleneck/<portfolio_name>` - Get bottleneck analysis

### File Operations
- `GET /files/<path>` - Download any portfolio file
- `GET /api/files/<portfolio_name>` - Get file listing with metadata

## Architecture

```
portfolioPlanner/
├── webapp/
│   ├── app.py              # Flask application and routes
│   ├── jobs.py             # Background job management
│   ├── templates/
│   │   └── index.html      # Main web interface
│   └── static/
│       └── app.js          # Frontend JavaScript
├── portfolios/
│   ├── portfoliotester/    # Example portfolio
│   │   ├── input/
│   │   │   ├── projects.csv
│   │   │   ├── resources.json
│   │   │   ├── config.json
│   │   │   └── programs.csv
│   │   └── output/
│   │       ├── projects.csv         # Scheduled projects
│   │       └── bottleneck_analysis.md
│   └── ea-roadmap/         # Another portfolio
├── portfolio_scheduler.py   # Core scheduling algorithm
└── run_webapp.py           # Web app startup script
```

## Portfolio Structure

Each portfolio should have this structure:

```
portfolio_name/
├── input/
│   ├── projects.csv       # Required: Project list with effort estimates
│   ├── resources.json     # Required: Resource configuration
│   ├── config.json        # Required: Planning start date
│   └── programs.csv       # Optional: Program definitions
└── output/
    ├── projects.csv       # Generated: Scheduled projects with dates
    └── bottleneck_analysis.md  # Generated: Resource utilization report
```

### Input File Formats

#### projects.csv
```csv
id,name,parent_summary,priority,effort_ba_pm,effort_planner_pm,effort_dev_pm
PROJ-1,Project Name,Program Name,1,2.0,1.0,3.0
```

#### resources.json
```json
{
  "time_off": {
    "holidays_per_year": 15,
    "avg_time_off_all_resources": 20
  },
  "resources": [
    {
      "type": "BA",
      "number": 2,
      "ktlo_percentage": 0.2,
      "wip_limit": 2
    },
    {
      "type": "Developer",
      "number": 5,
      "ktlo_percentage": 0.3,
      "avg_time_off": 40,
      "wip_limit": 2
    },
    {
      "type": "PM",
      "number": 2,
      "ktlo_percentage": 0.3,
      "wip_limit": 4
    }
  ]
}
```

#### config.json
```json
{
  "planning_start": "2025-12-01"
}
```

## Usage Workflow

1. **Select or Create Portfolio** - Choose an existing portfolio or create a new one
2. **Configure Projects** - Add/edit projects with effort estimates and priorities
3. **Configure Resources** - Set resource types, capacity, and constraints
4. **Run Model** - Click "Run Model" to execute the scheduler
5. **View Results** - Check the timeline and bottleneck analysis
6. **Iterate** - Adjust inputs and re-run as needed
7. **Export** - Download results for presentations or further analysis

## Tips

- **Start with Sample Data**: Creating a new portfolio gives you sample data to learn from
- **Priority Matters**: Projects are scheduled in priority order (1 = highest)
- **Watch for Bottlenecks**: Red/orange in bottleneck analysis indicates over-utilized resources
- **Adjust Capacity**: If projects aren't completing fast enough, increase resource counts
- **Use Programs**: Color-code related projects for better visual organization
- **Export Results**: Use the Files tab to download schedules and reports

## Troubleshooting

**Web app won't start:**
- Ensure Flask is installed: `pip install Flask`
- Check if port 5000 is available
- Try: `python3 run_webapp.py` instead of `python`

**Model fails to run:**
- Verify all required input files exist (projects.csv, resources.json, config.json)
- Check for JSON syntax errors in resources.json and config.json
- Ensure projects.csv has valid data (numeric effort values)

**No results showing:**
- Make sure the model completed successfully (check Recent Jobs table)
- Refresh the page after the model finishes
- Check output folder exists: `portfolios/<name>/output/`

**Changes not saving:**
- Look for error messages in the browser console (F12)
- Verify you have write permissions to the portfolios folder
- Check that the portfolio name doesn't contain special characters

## Development

To modify the web app:

1. **Backend**: Edit `webapp/app.py` for API endpoints
2. **Frontend**: Edit `webapp/templates/index.html` for UI
3. **Logic**: Edit `webapp/static/app.js` for client-side behavior
4. **Scheduling**: Edit `portfolio_scheduler.py` for algorithm changes

Run in debug mode for auto-reload on changes:
```bash
python run_webapp.py
```

## Command Line Alternative

You can also run the scheduler from command line:

```bash
python portfolio_scheduler.py <portfolio_name>
```

This is useful for:
- Batch processing
- Automation/scripts
- CI/CD pipelines
- Testing changes

## License

See main project README for license information.
