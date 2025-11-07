# Portfolio Planner

[![Run Tests](https://github.com/tommertron/portfolioPlanner/actions/workflows/tests.yml/badge.svg)](https://github.com/tommertron/portfolioPlanner/actions/workflows/tests.yml)

A resource-constrained project portfolio scheduler with an interactive web interface. Schedule projects based on resource availability, Work-In-Progress (WIP) limits, and KTLO (Keep The Lights On) constraints.

## Features

### Core Scheduling Engine
- **Resource-aware scheduling**: Allocates projects based on available capacity across multiple resource types (BA, PM, Developer, etc.)
- **WIP limit enforcement**: Respects per-person work-in-progress limits to prevent context switching
- **KTLO handling**: Accounts for ongoing operational work that reduces project capacity
- **Time-off calculations**: Factors in holidays and PTO when computing available capacity
- **Priority-based allocation**: Schedules higher-priority projects first
- **Minimum allocation threshold**: Prevents projects from spreading too thin over many months

### Interactive Web Interface
- **Graphical timeline view**: Visual project schedules with color-coded program bars
- **Quarter and year headers**: Easy-to-read date formatting (Jan-27, Q1 2027, etc.)
- **Multiple sort options**: Sort timeline by Program or Start Date
- **Subtabs for results**: Separate views for Timeline and Resource Analysis
- **Real-time status updates**: See model execution progress with duration tracking
- **Portfolio management**: Create, select, and manage multiple portfolios
- **Inline editing**: Edit projects, resources, and configuration directly in the browser

## Installation

### Prerequisites
- Python 3.8 or higher
- pip (Python package manager)

### Setup

1. Clone the repository:
```bash
git clone https://github.com/tommertron/portfolioPlanner.git
cd portfolioPlanner
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Start the web application:
```bash
./start.sh
```

Or manually:
```bash
python3 run_webapp.py
```

4. Open your browser to: `http://localhost:5000`

## Usage

### Web Interface

1. **Select or Create a Portfolio**
   - Use the dropdown to select an existing portfolio
   - Click "New Portfolio" to create a new one

2. **Configure Your Portfolio**
   - **Projects Tab**: Add projects with effort estimates (BA, PM, Dev person-months)
   - **Resources Tab**: Configure team size, KTLO percentages, WIP limits, and time off
   - **Settings Tab**: Set planning start date and other constraints

3. **Run the Model**
   - Click "Run Model" to generate the schedule
   - View results in the **Results** tab:
     - **Timeline**: Graphical view of project schedules
     - **Resource Analysis**: Bottleneck analysis and utilization metrics

4. **View and Sort Results**
   - Sort timeline by Program or Start Date
   - Export results as CSV or Markdown

### Command Line

Run the scheduler directly from the command line:

```bash
python3 portfolio_scheduler.py <portfolio_name>
```

Example:
```bash
python3 portfolio_scheduler.py ea-roadmap
```

## Portfolio Structure

Each portfolio is stored in the `portfolios/` directory with the following structure:

```
portfolios/
  └── my-portfolio/
      ├── input/
      │   ├── projects.csv      # Project definitions
      │   ├── resources.json    # Resource configuration
      │   ├── config.json       # Planning settings
      │   └── programs.csv      # Program definitions (optional)
      └── output/
          ├── projects.csv      # Scheduled projects with dates
          └── bottleneck_analysis.md  # Resource utilization report
```

### Input Files

#### `projects.csv`
```csv
effort_ba_pm,effort_planner_pm,effort_dev_pm,id,name,parent_summary,priority
1.5,0.5,3.0,PROJ-001,Authentication System,Security,1
```

Fields:
- `effort_ba_pm`: Business Analyst effort in person-months
- `effort_planner_pm`: Project Manager effort in person-months
- `effort_dev_pm`: Developer effort in person-months
- `id`: Unique project identifier
- `name`: Project name
- `parent_summary`: Program/portfolio this project belongs to
- `priority`: Lower numbers = higher priority

#### `resources.json`
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
      "type": "PM",
      "number": 3,
      "ktlo_percentage": 0.3,
      "wip_limit": 4
    },
    {
      "type": "Developer",
      "number": 8,
      "ktlo_percentage": 0.25,
      "wip_limit": 2
    }
  ]
}
```

Fields:
- `type`: Resource type name (must match project CSV columns)
- `number`: Number of people on the team
- `ktlo_percentage`: Percentage of time spent on operational work (0.2 = 20%)
- `wip_limit`: Maximum concurrent projects per person
- `avg_time_off`: Optional override for time off days (defaults to global setting)

#### `config.json`
```json
{
  "planning_start": "2025-01-01"
}
```

#### `programs.csv` (optional)
```csv
name,color
Security,#2563eb
Infrastructure,#059669
Customer Features,#d97706
```

## Key Concepts

### WIP (Work In Progress) Limits
WIP limits control how many projects a person can work on simultaneously. For example:
- 2 PMs with WIP limit of 4 = maximum 8 concurrent PM projects
- Prevents context switching and improves flow

### KTLO (Keep The Lights On)
KTLO percentage represents ongoing operational work:
- 20% KTLO means 80% of capacity available for projects
- Models realistic capacity after meetings, support, maintenance, etc.

### Minimum Allocation Threshold
Projects won't start unless they can receive at least 0.5 person-months per month:
- Prevents 1-month projects from spreading over a year
- Ensures meaningful progress each month
- Projects wait for sufficient capacity rather than starting with tiny allocations

## Technology Stack

- **Backend**: Python 3, Flask
- **Frontend**: Bootstrap 5, vanilla JavaScript
- **Scheduling**: Custom resource-constrained scheduling algorithm

## Testing

Run the unit test suite to verify the scheduler is working correctly:

```bash
python3 test_scheduler.py
```

The test suite includes:
- **WIP limit validation**: Ensures concurrent projects never exceed configured limits
- **Capacity constraint checks**: Verifies allocated capacity doesn't exceed available capacity
- **Priority ordering**: Confirms higher priority projects start first on average
- **Duration checks**: Ensures projects complete in reasonable timeframes
- **KTLO calculations**: Validates KTLO percentage reduces capacity correctly
- **Edge cases**: Tests zero-effort projects, single-resource projects, etc.

All tests use the `portfoliotester` portfolio for consistent validation.

### Running Tests After Changes

Always run the test suite after modifying the scheduling algorithm:

```bash
python3 test_scheduler.py
```

All tests should pass before committing changes.

### Continuous Integration

The repository uses GitHub Actions to automatically run tests on:
- Every push to the `main` branch
- Every pull request targeting `main`

Tests run on Python versions 3.8, 3.9, 3.10, 3.11, and 3.12 to ensure compatibility.

Pull requests will show a status check indicating whether tests pass. PRs cannot be merged if tests fail, ensuring code quality is maintained.

## Contributing

Contributions are welcome! Please:
1. Run the test suite and ensure all tests pass
2. Add new tests for any new functionality
3. Submit a Pull Request with a clear description

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

Built with assistance from Claude Code.
