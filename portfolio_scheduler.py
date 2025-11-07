#!/usr/bin/env python3
"""
Portfolio Project Scheduler

Schedules projects based on resource availability, WIP limits, and KTLO constraints.
"""

import csv
import json
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Tuple
from dateutil.relativedelta import relativedelta


class Resource:
    """Represents a resource type with capacity and constraints."""

    def __init__(self, resource_type: str, number: int, ktlo_percentage: float, wip_limit: int,
                 time_off_days: float = 0):
        self.type = resource_type
        self.number = number
        self.ktlo_percentage = ktlo_percentage
        self.wip_limit = wip_limit

        # Calculate time off percentage (assuming 250 working days per year)
        self.time_off_percentage = time_off_days / 250 if time_off_days > 0 else 0

        # Available capacity accounts for both KTLO and time off
        # Formula: capacity = number * (1 - ktlo) * (1 - time_off)
        self.available_capacity = number * (1 - ktlo_percentage) * (1 - self.time_off_percentage)

    def __repr__(self):
        return (f"Resource({self.type}, {self.number} people, "
                f"KTLO={self.ktlo_percentage:.1%}, TimeOff={self.time_off_percentage:.1%}, "
                f"{self.available_capacity:.2f} available)")


class Project:
    """Represents a project with effort requirements."""

    def __init__(self, project_id: str, name: str, parent: str, priority: int,
                 ba_effort: float, pm_effort: float, dev_effort: float):
        self.id = project_id
        self.name = name
        self.parent = parent
        self.priority = priority
        self.efforts = {
            'BA': ba_effort,
            'PM': pm_effort,
            'Developer': dev_effort
        }
        self.start_date = None
        self.end_date = None

    def total_effort(self) -> float:
        """Returns total effort across all resources."""
        return sum(self.efforts.values())

    def requires_resources(self) -> List[str]:
        """Returns list of resource types needed (effort > 0)."""
        return [rt for rt, effort in self.efforts.items() if effort > 0]

    def __repr__(self):
        return f"Project({self.id}: {self.name}, Priority={self.priority})"


class ProjectScheduler:
    """Schedules projects based on resource constraints with proper capacity allocation."""

    def __init__(self, resources: Dict[str, Resource], start_date: datetime):
        self.resources = resources
        self.start_date = start_date

        # Track capacity allocation per resource type per month index
        # Format: {resource_type: {month_index: allocated_capacity}}
        self.capacity_allocation = {rt: {} for rt in resources.keys()}

        # Track which projects are using each resource type per month
        # Format: {resource_type: {month_index: set(project_ids)}}
        self.monthly_active_projects = {rt: {} for rt in resources.keys()}

    def get_available_capacity(self, resource_type: str, month_index: int) -> float:
        """Get remaining available capacity for a resource in a specific month."""
        total_capacity = self.resources[resource_type].available_capacity
        allocated = self.capacity_allocation[resource_type].get(month_index, 0)
        return max(0, total_capacity - allocated)

    def get_active_project_count(self, resource_type: str, month_index: int) -> int:
        """Get number of active projects using a resource type in a specific month."""
        return len(self.monthly_active_projects[resource_type].get(month_index, set()))

    def can_start_project(self, project: Project, month_index: int) -> bool:
        """Check if project can start based on WIP limits."""
        for resource_type in project.requires_resources():
            active_count = self.get_active_project_count(resource_type, month_index)
            resource = self.resources[resource_type]
            # WIP limit is per person, so total limit = wip_limit × number of people
            total_wip_limit = resource.wip_limit * resource.number

            if active_count >= total_wip_limit:
                return False

        return True

    def allocate_capacity(self, project: Project, resource_type: str, month_index: int, amount: float):
        """Allocate capacity to a project for a specific resource and month."""
        if amount <= 0:
            return

        # Update capacity allocation
        if month_index not in self.capacity_allocation[resource_type]:
            self.capacity_allocation[resource_type][month_index] = 0
        self.capacity_allocation[resource_type][month_index] += amount

        # Update active projects tracking
        if month_index not in self.monthly_active_projects[resource_type]:
            self.monthly_active_projects[resource_type][month_index] = set()
        self.monthly_active_projects[resource_type][month_index].add(project.id)

    def schedule_project(self, project: Project):
        """Schedule a single project by allocating capacity month-by-month."""
        # Minimum allocation threshold per month (prevent spreading too thin)
        # A project should get at least 0.5 person-months per month per resource, or wait
        MIN_MONTHLY_ALLOCATION = 0.5

        # Find the earliest month the project can start (based on WIP limits)
        start_month = 0
        while not self.can_start_project(project, start_month):
            start_month += 1
            if start_month > 1000:  # Safety check
                print(f"Warning: Could not find start slot for {project.id}")
                project.start_date = self.start_date + relativedelta(months=start_month)
                project.end_date = project.start_date
                return

        # Track remaining effort for each resource type
        remaining_effort = {rt: effort for rt, effort in project.efforts.items() if effort > 0}

        # Allocate capacity month by month until project is complete
        current_month = start_month
        max_iterations = 1000  # Safety check
        project_started = False  # Track if any allocation has been made

        while any(effort > 0.001 for effort in remaining_effort.values()) and (current_month - start_month) < max_iterations:
            month_had_allocation = False

            # For each resource type, allocate available capacity
            for resource_type, effort in remaining_effort.items():
                if effort > 0.001:
                    available = self.get_available_capacity(resource_type, current_month)

                    # Can only allocate if WIP limit allows (check if project can be active this month)
                    can_be_active = True
                    if not self.can_start_project(project, current_month):
                        # Check if this project is already active (continuing from previous month)
                        if current_month > start_month and project.id in self.monthly_active_projects[resource_type].get(current_month - 1, set()):
                            # Project is continuing, it's okay
                            can_be_active = True
                        else:
                            # Can't start or continue this month due to WIP limits
                            can_be_active = False

                    if not can_be_active:
                        continue

                    # Apply minimum allocation threshold for new projects
                    # If this is the first month and we don't have enough capacity, wait
                    if not project_started and available < MIN_MONTHLY_ALLOCATION and available < effort:
                        # Not enough capacity to make meaningful progress, skip this month
                        continue

                    # Allocate up to what's available (but not more than remaining effort)
                    allocated = min(available, effort)

                    if allocated > 0:
                        self.allocate_capacity(project, resource_type, current_month, allocated)
                        remaining_effort[resource_type] -= allocated
                        month_had_allocation = True
                        project_started = True

            # If no allocation was made this month and project hasn't started, try next month
            if not month_had_allocation and not project_started:
                start_month = current_month + 1

            # Move to next month
            current_month += 1

        # Convert month indices to dates
        project.start_date = self.start_date + relativedelta(months=start_month)
        project.end_date = self.start_date + relativedelta(months=current_month)

    def schedule_all(self, projects: List[Project]) -> List[Project]:
        """Schedule all projects in priority order."""
        # Sort by priority
        projects.sort(key=lambda p: p.priority)

        for project in projects:
            self.schedule_project(project)

        return projects

    def generate_bottleneck_analysis(self) -> Dict:
        """Analyze resource utilization and identify bottlenecks."""
        analysis = {}

        for resource_type, resource in self.resources.items():
            total_capacity = resource.available_capacity

            # Calculate utilization per month
            monthly_utilization = {}
            for month_index, allocated in self.capacity_allocation[resource_type].items():
                utilization_pct = (allocated / total_capacity * 100) if total_capacity > 0 else 0
                monthly_utilization[month_index] = {
                    'allocated': allocated,
                    'available': total_capacity,
                    'utilization_pct': utilization_pct,
                    'active_projects': len(self.monthly_active_projects[resource_type].get(month_index, set()))
                }

            # Calculate statistics
            if monthly_utilization:
                avg_utilization = sum(m['utilization_pct'] for m in monthly_utilization.values()) / len(monthly_utilization)
                max_utilization = max(m['utilization_pct'] for m in monthly_utilization.values())
                months_at_capacity = sum(1 for m in monthly_utilization.values() if m['utilization_pct'] >= 90)
                months_high_utilization = sum(1 for m in monthly_utilization.values() if m['utilization_pct'] >= 75)
            else:
                avg_utilization = 0
                max_utilization = 0
                months_at_capacity = 0
                months_high_utilization = 0

            analysis[resource_type] = {
                'resource': resource,
                'monthly_utilization': monthly_utilization,
                'avg_utilization_pct': avg_utilization,
                'max_utilization_pct': max_utilization,
                'months_at_capacity': months_at_capacity,
                'months_high_utilization': months_high_utilization,
                'total_months_active': len(monthly_utilization)
            }

        return analysis


def load_projects(csv_path: Path) -> List[Project]:
    """Load projects from CSV file."""
    projects = []

    with open(csv_path, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            project = Project(
                project_id=row['id'],
                name=row['name'],
                parent=row['parent_summary'],
                priority=int(row['priority']),
                ba_effort=float(row['effort_ba_pm']),
                pm_effort=float(row['effort_planner_pm']),
                dev_effort=float(row['effort_dev_pm'])
            )
            projects.append(project)

    return projects


def load_resources(json_path: Path) -> Dict[str, Resource]:
    """Load resources from JSON file."""
    with open(json_path, 'r') as f:
        data = json.load(f)

    # Get global time off configuration
    time_off_config = data.get('time_off', {})
    holidays_per_year = time_off_config.get('holidays_per_year', 0)
    default_avg_time_off = time_off_config.get('avg_time_off_all_resources', 0)

    resources = {}
    for res_data in data['resources']:
        # Use resource-specific time off if provided, otherwise use default
        resource_time_off = res_data.get('avg_time_off', default_avg_time_off)

        # Total time off = holidays + vacation/PTO
        total_time_off_days = holidays_per_year + resource_time_off

        resource = Resource(
            resource_type=res_data['type'],
            number=res_data['number'],
            ktlo_percentage=res_data['ktlo_percentage'],
            wip_limit=res_data['wip_limit'],
            time_off_days=total_time_off_days
        )
        resources[resource.type] = resource

    return resources


def load_config(json_path: Path) -> Dict:
    """Load configuration from JSON file."""
    with open(json_path, 'r') as f:
        return json.load(f)


def save_results(projects: List[Project], output_path: Path):
    """Save scheduled projects to CSV file."""
    # Ensure output directory exists
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, 'w', newline='') as f:
        fieldnames = ['id', 'name', 'parent_summary', 'priority',
                      'effort_ba_pm', 'effort_planner_pm', 'effort_dev_pm',
                      'start_date', 'end_date']
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()

        for project in projects:
            writer.writerow({
                'id': project.id,
                'name': project.name,
                'parent_summary': project.parent,
                'priority': project.priority,
                'effort_ba_pm': project.efforts['BA'],
                'effort_planner_pm': project.efforts['PM'],
                'effort_dev_pm': project.efforts['Developer'],
                'start_date': project.start_date.strftime('%Y-%m-%d'),
                'end_date': project.end_date.strftime('%Y-%m-%d')
            })


def save_bottleneck_analysis(analysis: Dict, output_path: Path, start_date: datetime):
    """Save resource bottleneck analysis to a markdown file."""
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, 'w') as f:
        f.write("# Resource Bottleneck Analysis\n\n")

        # Sort by average utilization (highest first)
        sorted_resources = sorted(
            analysis.items(),
            key=lambda x: x[1]['avg_utilization_pct'],
            reverse=True
        )

        f.write("## Summary - Resource Utilization\n\n")
        f.write("| Resource Type | Avg % | Max % | Months @Capacity | Months High Util |\n")
        f.write("|---------------|-------|-------|------------------|------------------|\n")

        for resource_type, data in sorted_resources:
            status_icon = "🔴" if data['avg_utilization_pct'] >= 80 else \
                         "🟡" if data['avg_utilization_pct'] >= 60 else "🟢"
            f.write(f"| {status_icon} **{resource_type}** | "
                   f"{data['avg_utilization_pct']:.1f}% | "
                   f"{data['max_utilization_pct']:.1f}% | "
                   f"{data['months_at_capacity']} months | "
                   f"{data['months_high_utilization']} months |\n")

        f.write("\n**Legend:**\n")
        f.write("- **Avg %**: Average utilization across all active months\n")
        f.write("- **Max %**: Peak utilization month\n")
        f.write("- **Months @Capacity**: Months at ≥90% utilization\n")
        f.write("- **Months High Util**: Months at ≥75% utilization\n")
        f.write("- 🔴 Bottleneck (≥80%) | 🟡 Moderate (60-79%) | 🟢 Low (<60%)\n\n")

        f.write("---\n\n")

        # Detailed analysis per resource
        for resource_type, data in sorted_resources:
            resource = data['resource']
            f.write(f"## {resource_type} - Detailed Analysis\n\n")

            f.write("### Resource Configuration\n\n")
            f.write(f"- **Total People**: {resource.number}\n")
            f.write(f"- **KTLO**: {resource.ktlo_percentage:.0%}\n")
            f.write(f"- **Time Off**: {resource.time_off_percentage:.0%}\n")
            f.write(f"- **Available Capacity**: {resource.available_capacity:.2f} person-months/month\n")
            f.write(f"- **WIP Limit**: {resource.wip_limit} concurrent projects\n\n")

            f.write("### Utilization Statistics\n\n")
            f.write(f"- **Average Utilization**: {data['avg_utilization_pct']:.1f}%\n")
            f.write(f"- **Peak Utilization**: {data['max_utilization_pct']:.1f}%\n")
            f.write(f"- **Months at Capacity (≥90%)**: {data['months_at_capacity']}\n")
            f.write(f"- **Months at High Utilization (≥75%)**: {data['months_high_utilization']}\n")
            f.write(f"- **Total Active Months**: {data['total_months_active']}\n\n")

            # Show bottleneck assessment
            if data['avg_utilization_pct'] >= 80:
                f.write(f"### ⚠️ BOTTLENECK IDENTIFIED\n\n")
                f.write(f"This resource type is **heavily utilized** ({data['avg_utilization_pct']:.1f}% avg).\n\n")

                # Calculate suggested additional resources
                if data['avg_utilization_pct'] > 100:
                    shortage_pct = (data['avg_utilization_pct'] - 80) / 100
                    additional_needed = resource.number * shortage_pct
                    f.write(f"**Recommendation**: Add {additional_needed:.1f} more {resource_type}(s)\n\n")
            elif data['avg_utilization_pct'] >= 60:
                f.write(f"### ℹ️ MODERATE UTILIZATION\n\n")
                f.write(f"This resource is reasonably utilized but not over-constrained.\n\n")
            else:
                f.write(f"### ✅ LOW UTILIZATION\n\n")
                f.write(f"This resource has excess capacity.\n\n")

            # Monthly breakdown for high utilization resources
            if data['avg_utilization_pct'] >= 60:
                f.write(f"### Monthly Utilization\n\n")
                f.write("Showing months with ≥50% utilization:\n\n")
                f.write("| Month | Date | Utilization | Active Projects |\n")
                f.write("|-------|------|-------------|------------------|\n")

                # Sort by month index
                high_util_months = [
                    (month_idx, util_data)
                    for month_idx, util_data in sorted(data['monthly_utilization'].items())
                    if util_data['utilization_pct'] >= 50
                ]

                for month_idx, util_data in high_util_months[:24]:  # Show first 24 months
                    month_date = start_date + relativedelta(months=month_idx)
                    month_str = month_date.strftime('%Y-%m')

                    # Create progress bar using markdown
                    bar_length = int(util_data['utilization_pct'] / 5)
                    bar = '█' * min(bar_length, 20)

                    f.write(f"| {month_idx} | {month_str} | "
                           f"`{bar:<20}` {util_data['utilization_pct']:>5.1f}% | "
                           f"{util_data['active_projects']} |\n")

                if len(high_util_months) > 24:
                    f.write(f"\n*... and {len(high_util_months) - 24} more months*\n")
                f.write("\n")

            f.write("---\n\n")

        f.write("*End of Analysis*\n")


def main():
    if len(sys.argv) != 2:
        print("Usage: python portfolio_scheduler.py <portfolio_folder>")
        print("Example: python portfolio_scheduler.py portfoliotester")
        sys.exit(1)

    portfolio_name = sys.argv[1]
    base_path = Path(__file__).parent / 'portfolios' / portfolio_name

    # Input paths
    input_path = base_path / 'input'
    projects_csv = input_path / 'projects.csv'
    resources_json = input_path / 'resources.json'
    config_json = input_path / 'config.json'

    # Output path
    output_path = base_path / 'output' / 'projects.csv'

    # Validate input files exist
    for path in [projects_csv, resources_json, config_json]:
        if not path.exists():
            print(f"Error: Required file not found: {path}")
            sys.exit(1)

    # Load data
    print(f"Loading data from {base_path}...")
    projects = load_projects(projects_csv)
    resources = load_resources(resources_json)
    config = load_config(config_json)

    # Parse start date
    start_date = datetime.strptime(config['planning_start'], '%Y-%m-%d')

    print(f"\nLoaded {len(projects)} projects")
    print(f"Resources: {list(resources.keys())}")
    print(f"Planning start: {start_date.strftime('%Y-%m-%d')}\n")

    # Schedule projects
    print("Scheduling projects...")
    scheduler = ProjectScheduler(resources, start_date)
    scheduled_projects = scheduler.schedule_all(projects)

    # Save results
    print(f"Saving results to {output_path}...")
    save_results(scheduled_projects, output_path)

    # Generate and save bottleneck analysis
    print(f"Generating bottleneck analysis...")
    analysis = scheduler.generate_bottleneck_analysis()
    bottleneck_output_path = base_path / 'output' / 'bottleneck_analysis.md'
    save_bottleneck_analysis(analysis, bottleneck_output_path, start_date)
    print(f"Bottleneck analysis saved to {bottleneck_output_path}")

    print("\nScheduling complete!")
    print(f"\nSummary:")
    print(f"  First project starts: {min(p.start_date for p in scheduled_projects).strftime('%Y-%m-%d')}")
    print(f"  Last project ends: {max(p.end_date for p in scheduled_projects).strftime('%Y-%m-%d')}")

    # Print quick bottleneck summary
    print(f"\nResource Utilization Summary:")
    sorted_resources = sorted(
        analysis.items(),
        key=lambda x: x[1]['avg_utilization_pct'],
        reverse=True
    )
    for resource_type, data in sorted_resources:
        status = "🔴 BOTTLENECK" if data['avg_utilization_pct'] >= 80 else \
                 "🟡 MODERATE" if data['avg_utilization_pct'] >= 60 else \
                 "🟢 LOW"
        print(f"  {resource_type:<15} {data['avg_utilization_pct']:>5.1f}% avg utilization  {status}")
    print(f"\n  See {bottleneck_output_path} for detailed analysis.")


if __name__ == '__main__':
    main()
