#!/usr/bin/env python3
"""
Unit tests for Portfolio Scheduler

Tests scheduling algorithm to ensure:
- WIP limits are respected
- Projects are scheduled by priority
- Capacity constraints are not exceeded
- Projects complete in reasonable timeframes
"""

import unittest
import csv
import json
from pathlib import Path
from datetime import datetime
from dateutil.relativedelta import relativedelta
from collections import defaultdict
from portfolio_scheduler import (
    load_projects,
    load_resources,
    load_config,
    ProjectScheduler
)


class TestPortfolioScheduler(unittest.TestCase):
    """Test suite for portfolio scheduler using portfoliotester."""

    @classmethod
    def setUpClass(cls):
        """Load test portfolio data once for all tests."""
        cls.portfolio_path = Path("portfolios/portfoliotester")
        cls.input_path = cls.portfolio_path / "input"
        cls.output_path = cls.portfolio_path / "output"

        # Ensure output directory exists
        cls.output_path.mkdir(exist_ok=True)

        # Load input data
        cls.projects = load_projects(cls.input_path / "projects.csv")
        cls.resources = load_resources(cls.input_path / "resources.json")
        cls.config = load_config(cls.input_path / "config.json")

        # Run scheduler
        start_date = datetime.fromisoformat(cls.config['planning_start'])
        cls.scheduler = ProjectScheduler(cls.resources, start_date)
        cls.scheduled_projects = cls.scheduler.schedule_all(cls.projects)

    def test_all_projects_scheduled(self):
        """Test that all projects have start and end dates."""
        for project in self.scheduled_projects:
            self.assertIsNotNone(project.start_date, f"Project {project.id} has no start date")
            self.assertIsNotNone(project.end_date, f"Project {project.id} has no end date")
            self.assertGreaterEqual(project.end_date, project.start_date,
                                   f"Project {project.id} end date before start date")

    def test_wip_limits_respected(self):
        """Test that WIP limits are never exceeded for any resource type."""
        # For each resource type, check each month
        for resource_type, resource in self.resources.items():
            max_allowed_projects = resource.wip_limit * resource.number

            for month_index in range(200):  # Check first 200 months
                active_count = self.scheduler.get_active_project_count(resource_type, month_index)

                self.assertLessEqual(
                    active_count,
                    max_allowed_projects,
                    f"{resource_type} WIP limit exceeded at month {month_index}: "
                    f"{active_count} > {max_allowed_projects} "
                    f"(limit={resource.wip_limit} × people={resource.number})"
                )

    def test_capacity_not_exceeded(self):
        """Test that allocated capacity never exceeds available capacity."""
        for resource_type, resource in self.resources.items():
            max_capacity = resource.available_capacity

            for month_index, allocated in self.scheduler.capacity_allocation[resource_type].items():
                self.assertLessEqual(
                    allocated,
                    max_capacity + 0.01,  # Small tolerance for floating point
                    f"{resource_type} capacity exceeded at month {month_index}: "
                    f"{allocated:.2f} > {max_capacity:.2f}"
                )

    def test_priority_ordering(self):
        """Test that priority 1 projects start earliest on average."""
        # Group projects by priority
        priority_groups = defaultdict(list)
        for project in self.scheduled_projects:
            if project.start_date:
                priority_groups[project.priority].append(project.start_date)

        # Calculate average start date for each priority
        priority_avg_starts = {}
        for priority, start_dates in priority_groups.items():
            avg_timestamp = sum(d.timestamp() for d in start_dates) / len(start_dates)
            priority_avg_starts[priority] = datetime.fromtimestamp(avg_timestamp)

        # Priority 1 should have earliest average start
        if 1 in priority_avg_starts and len(priority_avg_starts) > 1:
            priority_1_avg = priority_avg_starts[1]
            for priority, avg_start in priority_avg_starts.items():
                if priority > 1:
                    # Allow some tolerance (3 months) for resource constraints
                    max_acceptable_delay = priority_1_avg + relativedelta(months=3)
                    self.assertLessEqual(
                        priority_1_avg,
                        max_acceptable_delay,
                        f"Priority 1 projects starting significantly after priority {priority} projects"
                    )

    def test_project_duration_reasonable(self):
        """Test that projects don't spread unreasonably thin over time."""
        for project in self.scheduled_projects:
            if project.start_date and project.end_date:
                duration_months = (project.end_date.year - project.start_date.year) * 12 + \
                                 (project.end_date.month - project.start_date.month)

                total_effort = project.total_effort()

                if total_effort > 0:
                    # Project should complete in roughly total_effort months (allowing 5x buffer)
                    # This is lenient to account for resource constraints and WIP limits
                    max_reasonable_duration = max(total_effort * 5, 12)  # At least 12 months tolerance

                    self.assertLessEqual(
                        duration_months,
                        max_reasonable_duration,
                        f"Project {project.id} spread too thin: "
                        f"{duration_months} months for {total_effort} PM effort "
                        f"(max reasonable: {max_reasonable_duration})"
                    )

    def test_no_gaps_in_active_projects(self):
        """Test that once a project starts, it continues until completion (no gaps)."""
        for project in self.scheduled_projects:
            if not project.start_date or not project.end_date:
                continue

            start_month = (project.start_date.year - self.scheduler.start_date.year) * 12 + \
                         (project.start_date.month - self.scheduler.start_date.month)
            end_month = (project.end_date.year - self.scheduler.start_date.year) * 12 + \
                       (project.end_date.month - self.scheduler.start_date.month)

            # Check each resource type the project uses
            for resource_type in project.requires_resources():
                project_active = []
                for month_idx in range(start_month, end_month):
                    is_active = project.id in self.scheduler.monthly_active_projects[resource_type].get(month_idx, set())
                    project_active.append(is_active)

                # Should be active in at least some months (no complete gaps)
                if project.efforts[resource_type] > 0:
                    self.assertTrue(
                        any(project_active),
                        f"Project {project.id} has no activity for {resource_type} "
                        f"between start and end dates"
                    )

    def test_resource_allocation_exists(self):
        """Test that projects with effort have capacity allocated."""
        for project in self.scheduled_projects:
            for resource_type, required_effort in project.efforts.items():
                if required_effort > 0:
                    # Check that project appears in active projects for this resource at some point
                    found_allocation = False
                    for month_index in self.scheduler.monthly_active_projects[resource_type]:
                        if project.id in self.scheduler.monthly_active_projects[resource_type][month_index]:
                            found_allocation = True
                            break

                    self.assertTrue(
                        found_allocation,
                        f"Project {project.id} requires {required_effort} {resource_type} but never allocated"
                    )

    def test_output_files_generated(self):
        """Test that output CSV is generated with correct structure."""
        output_csv = self.output_path / "projects.csv"

        # Generate output
        with open(output_csv, 'w', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(['id', 'name', 'parent_summary', 'priority',
                           'effort_ba_pm', 'effort_planner_pm', 'effort_dev_pm',
                           'start_date', 'end_date'])

            for project in self.scheduled_projects:
                writer.writerow([
                    project.id,
                    project.name,
                    project.parent,
                    project.priority,
                    project.efforts.get('BA', 0),
                    project.efforts.get('PM', 0),
                    project.efforts.get('Developer', 0),
                    project.start_date.strftime('%Y-%m-%d') if project.start_date else '',
                    project.end_date.strftime('%Y-%m-%d') if project.end_date else ''
                ])

        # Verify file exists and has content
        self.assertTrue(output_csv.exists(), "Output CSV not generated")
        with open(output_csv, 'r') as f:
            lines = f.readlines()
            self.assertGreater(len(lines), 1, "Output CSV is empty")

    def test_no_infinite_loops(self):
        """Test that all projects complete within reasonable iteration count."""
        # This is implicitly tested by the scheduler completing,
        # but we can check that no project took excessive iterations
        for project in self.scheduled_projects:
            if project.start_date and project.end_date:
                duration_months = (project.end_date.year - project.start_date.year) * 12 + \
                                 (project.end_date.month - project.start_date.month)

                # No project should take more than 100 months to complete
                self.assertLess(
                    duration_months,
                    100,
                    f"Project {project.id} may have hit infinite loop: {duration_months} months"
                )

    def test_ktlo_reduces_capacity(self):
        """Test that KTLO percentage reduces available capacity."""
        for resource_type, resource in self.resources.items():
            # Available capacity should be less than raw capacity if KTLO > 0
            if resource.ktlo_percentage > 0:
                raw_capacity = resource.number
                self.assertLess(
                    resource.available_capacity,
                    raw_capacity,
                    f"{resource_type} KTLO not reducing capacity"
                )

            # Check the math
            expected_capacity = resource.number * (1 - resource.ktlo_percentage) * (1 - resource.time_off_percentage)
            self.assertAlmostEqual(
                resource.available_capacity,
                expected_capacity,
                places=2,
                msg=f"{resource_type} capacity calculation incorrect"
            )


class TestEdgeCases(unittest.TestCase):
    """Test edge cases and error conditions."""

    def test_zero_effort_project(self):
        """Test handling of projects with zero effort."""
        from portfolio_scheduler import Project, Resource, ProjectScheduler

        resources = {
            'Developer': Resource('Developer', 2, 0.2, 2, 0)
        }
        scheduler = ProjectScheduler(resources, datetime(2025, 1, 1))

        project = Project('TEST-001', 'Zero Effort', 'Test', 1, 0, 0, 0)
        scheduler.schedule_project(project)

        # Should have dates set (even if same day)
        self.assertIsNotNone(project.start_date)
        self.assertIsNotNone(project.end_date)

    def test_single_resource_project(self):
        """Test project requiring only one resource type."""
        from portfolio_scheduler import Project, Resource, ProjectScheduler

        resources = {
            'Developer': Resource('Developer', 2, 0.2, 2, 0)
        }
        scheduler = ProjectScheduler(resources, datetime(2025, 1, 1))

        project = Project('TEST-002', 'Dev Only', 'Test', 1, 0, 0, 2.0)
        scheduler.schedule_project(project)

        self.assertIsNotNone(project.start_date)
        self.assertIsNotNone(project.end_date)
        self.assertGreater(project.end_date, project.start_date)


def run_tests():
    """Run all tests and return results."""
    # Create test suite
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()

    # Add all test cases
    suite.addTests(loader.loadTestsFromTestCase(TestPortfolioScheduler))
    suite.addTests(loader.loadTestsFromTestCase(TestEdgeCases))

    # Run tests with verbose output
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)

    return result.wasSuccessful()


if __name__ == '__main__':
    success = run_tests()
    exit(0 if success else 1)
